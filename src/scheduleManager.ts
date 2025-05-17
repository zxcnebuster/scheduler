import {
  Account,
  AccountAvailability,
  Order,
  ScheduledPurchase,
  TaskToSchedule,
  PurchaseStatus,
} from "./types";
import { PurchaseScheduler } from "./scheduler";
import { dateToDateString } from "./utils";

interface AuditLogEntry {
  timestamp: Date;
  action: string;
  details: any;
  reason?: string;
}

export class ScheduleManager {
  //controls how system should reach when things do not go as planned or when an operator needs to intevene
  private masterSchedule: ScheduledPurchase[] = [];
  private scheduler: PurchaseScheduler;
  private allAccounts: Account[] = [];
  private accountAvailability: AccountAvailability = {}; //master state of account availability
  private auditLog: AuditLogEntry[] = []; //in-memory for now

  constructor(
    initialAccounts: Account[],
    initialAvailability: AccountAvailability = {}
  ) {
    this.scheduler = new PurchaseScheduler({
      logInfo: (message) => this.logAudit("SCHEDULER_INFO", { message }),
      logError: (message) => this.logAudit("SCHEDULER_ERROR", { message }),
      logWarning: (message) => this.logAudit("SCHEDULER_WARNING", { message }),
    });
    this.allAccounts = [...initialAccounts];
    this.accountAvailability = JSON.parse(JSON.stringify(initialAvailability));
    this.logAudit(
      "INIT",
      { initialAccounts, initialAvailability },
      "System initialized"
    );
  }

  private logAudit(action: string, details: any, reason?: string) {
    const entry: AuditLogEntry = {
      timestamp: new Date(),
      action,
      details,
      reason,
    };
    this.auditLog.push(entry);
    //this should write to a persistent log store
    //console.log(`AUDIT: ${action} - ${JSON.stringify(details)} ${reason ? `- Reason: ${reason}` : ''}`);
  }

  public getFullSchedule(): ReadonlyArray<ScheduledPurchase> {
    return [...this.masterSchedule].sort(
      (a, b) => a.purchaseDate.getTime() - b.purchaseDate.getTime()
    );
  }

  public getAuditLog(): ReadonlyArray<AuditLogEntry> {
    return [...this.auditLog];
  }

  public addAccount(account: Account): void {
    if (!this.allAccounts.find((a) => a.id === account.id)) {
      this.allAccounts.push(account);
      this.logAudit("ACCOUNT_ADDED", {
        accountId: account.id,
        name: account.name,
      });
    }
  }

  public setAccountAvailability(
    accountId: string,
    unavailableDates: Date[],
    availableDates?: Date[]
  ): void {
    if (!this.allAccounts.find((a) => a.id === accountId)) {
      this.logAudit(
        "SET_AVAILABILITY_FAIL",
        { accountId },
        "Account not found"
      );
      throw new Error(`Account ${accountId} not found.`);
    }

    const currentAvailability = this.accountAvailability[accountId] || {
      unavailableDates: [],
    };
    let changed = false;

    //process new unavailable dates
    const newUnavailableDateStrings = new Set(
      unavailableDates.map(dateToDateString)
    );
    const existingUnavailableDateStrings = new Set(
      (currentAvailability.unavailableDates || []).map(dateToDateString)
    );

    for (const dateStr of newUnavailableDateStrings) {
      if (!existingUnavailableDateStrings.has(dateStr)) {
        existingUnavailableDateStrings.add(dateStr);
        changed = true;
      }
    }

    //process dates to make available (remove from unavailable)
    if (availableDates) {
      const availableDateStrings = new Set(
        availableDates.map(dateToDateString)
      );
      for (const dateStr of availableDateStrings) {
        if (existingUnavailableDateStrings.has(dateStr)) {
          existingUnavailableDateStrings.delete(dateStr);
          changed = true;
        }
      }
    }

    this.accountAvailability[accountId] = {
      unavailableDates: Array.from(existingUnavailableDateStrings).map(
        (str) => new Date(str + "T00:00:00.000Z")
      ), // Convert back to Date, ensuring UTC
    };

    if (changed) {
      this.logAudit(
        "ACCOUNT_AVAILABILITY_UPDATED",
        {
          accountId,
          unavailableDates:
            this.accountAvailability[accountId].unavailableDates,
        },
        "Account availability changed"
      );
      //identify tasks scheduled on now-unavailable slots for this account
      const tasksToReschedule: TaskToSchedule[] = [];
      const remainingSchedule: ScheduledPurchase[] = [];

      this.masterSchedule.forEach((purchase) => {
        if (
          purchase.accountId === accountId &&
          purchase.status === "pending" && //only reschedule pending tasks
          this.accountAvailability[accountId].unavailableDates?.some(
            (d) =>
              dateToDateString(d) === dateToDateString(purchase.purchaseDate)
          )
        ) {
          tasksToReschedule.push(
            ...PurchaseScheduler.scheduledItemsToTasks([purchase])
          );
          this.logAudit("TASK_FLAGGED_FOR_RESCHEDULE", {
            purchaseId: purchase.purchaseId,
            reason: "Account now unavailable",
          });
        } else {
          remainingSchedule.push(purchase);
        }
      });

      if (tasksToReschedule.length > 0) {
        this.masterSchedule = remainingSchedule; //remove them from master
        this.processTasks(
          tasksToReschedule,
          "Rescheduling due to account unavailability change"
        );
      }
    }
  }

  public addNewOrders(
    orders: Order[],
    today: Date = new Date(
      Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        new Date().getUTCDate()
      )
    )
  ): void {
    const newTasks = PurchaseScheduler.ordersToTasks(orders);
    if (newTasks.length === 0) return;

    this.logAudit("NEW_ORDERS_RECEIVED", {
      orderIds: orders.map((o) => o.id),
      taskCount: newTasks.length,
    });
    this.processTasks(newTasks, "Processing new orders", today);
  }

  public markPurchaseStatus(
    purchaseId: string,
    status: PurchaseStatus,
    reason?: string,
    today: Date = new Date(
      Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        new Date().getUTCDate()
      )
    )
  ): void {
    const purchaseIndex = this.masterSchedule.findIndex(
      (p) => p.purchaseId === purchaseId
    );
    if (purchaseIndex === -1) {
      this.logAudit(
        "MARK_STATUS_FAIL",
        { purchaseId, status },
        "Purchase not found"
      );
      throw new Error(`Purchase with ID ${purchaseId} not found in schedule.`);
    }

    const purchase = this.masterSchedule[purchaseIndex];
    if (purchase.status === status) return;

    const oldStatus = purchase.status;
    purchase.status = status;
    this.logAudit(
      "PURCHASE_STATUS_UPDATED",
      { purchaseId, oldStatus, newStatus: status, bookId: purchase.bookId },
      reason
    );

    if (status === "missed" || status === "delayed") {
      //'delayed' implies it needs rescheduling
      //remove from master schedule and add to tasks to process
      const [missedPurchase] = this.masterSchedule.splice(purchaseIndex, 1);
      const tasksToReschedule = PurchaseScheduler.scheduledItemsToTasks([
        missedPurchase,
      ]);

      this.logAudit("TASK_FLAGGED_FOR_RESCHEDULE", {
        purchaseId: missedPurchase.purchaseId,
        reason: `Status changed to ${status}`,
      });
      this.processTasks(
        tasksToReschedule,
        `Rescheduling due to purchase ${status}`,
        today
      );
    }
  }

  //central method for processing tasks (new or rescheduled)
  private processTasks(
    tasksToProcess: TaskToSchedule[],
    reasonForProcessing: string,
    today: Date = new Date(
      Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        new Date().getUTCDate()
      )
    )
  ): void {
    if (tasksToProcess.length === 0) return;

    this.logAudit("PROCESSING_TASKS_START", {
      taskCount: tasksToProcess.length,
      reason: reasonForProcessing,
    });

    //ensure 'existingCommittedSchedule' only contains 'pending' or 'completed' items
    //items marked 'missed' or 'delayed' should have already been removed and re-added to tasksToProcess if needed
    const committedSchedule = this.masterSchedule.filter(
      (p) => p.status === "pending" || p.status === "completed"
    );

    const { scheduledItems, unschedulableTasks } =
      this.scheduler.generateSchedule(
        tasksToProcess,
        committedSchedule,
        this.allAccounts,
        this.accountAvailability,
        today
      );

    this.masterSchedule = [...committedSchedule, ...scheduledItems].sort(
      (a, b) => a.purchaseDate.getTime() - b.purchaseDate.getTime()
    ); // Combine and re-sort

    if (scheduledItems.length > 0) {
      this.logAudit("TASKS_SCHEDULED", {
        count: scheduledItems.length,
        items: scheduledItems.map((p) => ({
          reviewId: p.reviewId,
          date: dateToDateString(p.purchaseDate),
          account: p.accountId,
        })),
      });
    }

    if (unschedulableTasks.length > 0) {
      //handle unschedulable tasks:
      //- Log them prominently.
      //- Potentially add them to a separate "dead letter" queue or mark them in a way that they are not continuously retried without intervention.
      //store them separately or raise alerts
      this.logAudit(
        "UNSCHEDULABLE_TASKS_ENCOUNTERED",
        {
          count: unschedulableTasks.length,
          tasks: unschedulableTasks.map((t) => ({
            reviewId: t.reviewId,
            bookId: t.bookId,
          })),
        },
        "Some tasks could not be scheduled"
      );
      //сonsider how these unschedulable tasks are persisted or re-attempted later
    }
    this.logAudit("PROCESSING_TASKS_END", { reason: reasonForProcessing });
  }

  //More methods to be added:
  //- Manually adjust a specific task's date/account (complex, might involve unscheduling then rescheduling)
  //- Get daily task lists
}
