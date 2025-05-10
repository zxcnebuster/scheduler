import {
  Order,
  ScheduledPurchase,
  Account,
  AccountAvailability,
  AccountDailyRunStatus,
  TaskToSchedule,
  OrderItem,
} from "./types";
import { dateToDateString, addDays } from "./utils";

export const MAX_PURCHASES_PER_ACCOUNT_PER_DAY = 3;
export const MIN_REVIEW_DELAY_DAYS = 4;
export const MAX_SCHEDULING_ATTEMPT_DAYS = 365; //break for scheduling loop

interface SchedulerLogger {
  logInfo: (message: string) => void;
  logError: (message: string) => void;
  logWarning: (message: string) => void;
}

const defaultLogger: SchedulerLogger = {
  //some simple logger
  logInfo: (message) => console.log(`INFO: ${message}`),
  logError: (message) => console.error(`ERROR: ${message}`),
  logWarning: (message) => console.warn(`WARN: ${message}`),
};

export class PurchaseScheduler {
  private logger: SchedulerLogger;

  constructor(logger?: SchedulerLogger) {
    this.logger = logger || defaultLogger;
  }

  /**
   * function to schedule new tasks or reschedule existing ones
   * @param tasksToProcess a list of tasks that need to be (re)scheduled
   * @param existingCommittedSchedule all currently valid, scheduled purchases NOT being actively rescheduled
   * @param allAccounts list of available Amazon accounts
   * @param accountAvailability  information about when accounts might be unavailable
   * @param today  current date, used as the starting point for scheduling
   * @returns a list of newly scheduled or rescheduled purchases
   */
  public generateSchedule(
    tasksToProcess: TaskToSchedule[],
    existingCommittedSchedule: ScheduledPurchase[],
    allAccounts: Account[],
    accountAvailability: AccountAvailability = {},
    today: Date = new Date(
      Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        new Date().getUTCDate()
      )
    ) //ensures today is UTC midnight
  ): {
    scheduledItems: ScheduledPurchase[];
    unschedulableTasks: TaskToSchedule[];
  } {
    const currentSchedulingRunState = new Map<
      string,
      Map<string, AccountDailyRunStatus>
    >();

    // 1. initialize currentSchedulingRunState based on existingCommittedSchedule and accountAvailability
    this.initializeRunState(
      currentSchedulingRunState,
      existingCommittedSchedule,
      accountAvailability,
      allAccounts
    );

    const newlyScheduledPurchases: ScheduledPurchase[] = [];
    const unschedulableTasks: TaskToSchedule[] = [];

    // 2. Sort tasksToProcess?
    // example: prioritize older orders or tasks that were previously scheduled earlier if rescheduling.
    // for now, processing in the order they are received.

    // 3. for each task, find the earliest possible slot
    for (const task of tasksToProcess) {
      let earliestSlotFound: { accountId: string; purchaseDate: Date } | null =
        null;
      let attemptedDays = 0;
      let currentAttemptDate = new Date(today); //start search from 'today'

      while (
        earliestSlotFound === null &&
        attemptedDays < MAX_SCHEDULING_ATTEMPT_DAYS
      ) {
        const dateStr = dateToDateString(currentAttemptDate);
        const potentialSlotsThisDay: {
          accountId: string;
          currentLoad: number;
        }[] = [];

        for (const account of allAccounts) {
          //ensure daily status entry exists for this account on currentattemptdate
          if (!currentSchedulingRunState.has(account.id)) {
            currentSchedulingRunState.set(account.id, new Map());
          }
          if (!currentSchedulingRunState.get(account.id)!.has(dateStr)) {
            currentSchedulingRunState.get(account.id)!.set(dateStr, {
              purchaseCount: 0,
              booksPurchasedToday: new Set(),
              unavailable: this.isAccountUnavailableOnDate(
                account.id,
                currentAttemptDate,
                accountAvailability
              ),
            });
          }

          const dailyStatus = currentSchedulingRunState
            .get(account.id)!
            .get(dateStr)!;

          // CONSTRAINT CHECKS:
          if (dailyStatus.unavailable) continue;
          if (dailyStatus.purchaseCount >= MAX_PURCHASES_PER_ACCOUNT_PER_DAY)
            continue;
          if (dailyStatus.booksPurchasedToday.has(task.bookId)) continue;

          potentialSlotsThisDay.push({
            accountId: account.id,
            currentLoad: dailyStatus.purchaseCount,
          });
        } //end for each account

        if (potentialSlotsThisDay.length > 0) {
          potentialSlotsThisDay.sort((a, b) => a.currentLoad - b.currentLoad); //load balancing
          const chosenAccountSlot = potentialSlotsThisDay[0];
          earliestSlotFound = {
            accountId: chosenAccountSlot.accountId,
            purchaseDate: new Date(currentAttemptDate), //clone date
          };
        } else {
          currentAttemptDate = addDays(currentAttemptDate, 1);
          attemptedDays++;
        }
      } //end while for finding slot

      if (earliestSlotFound) {
        const reviewDate = addDays(
          earliestSlotFound.purchaseDate,
          MIN_REVIEW_DELAY_DAYS
        );
        const scheduledItem: ScheduledPurchase = {
          purchaseId: task.reviewId, //using reviewid as purchaseid for simplicity
          reviewId: task.reviewId,
          orderId: task.orderId,
          bookId: task.bookId,
          accountId: earliestSlotFound.accountId,
          purchaseDate: earliestSlotFound.purchaseDate,
          reviewDate: reviewDate,
          status: "pending",
          client: task.clientId,
        };
        newlyScheduledPurchases.push(scheduledItem);

        // CRITICAL: update currentSchedulingRunState for the chosen slot
        const chosenDateStr = dateToDateString(earliestSlotFound.purchaseDate);
        const chosenAccountDailyStatus = currentSchedulingRunState
          .get(earliestSlotFound.accountId)!
          .get(chosenDateStr)!;
        chosenAccountDailyStatus.purchaseCount++;
        chosenAccountDailyStatus.booksPurchasedToday.add(task.bookId);
      } else {
        this.logger.logWarning(
          `Could not schedule task for reviewId: ${task.reviewId}, bookId: ${task.bookId} within ${MAX_SCHEDULING_ATTEMPT_DAYS} days.`
        );
        unschedulableTasks.push(task);
      }
    } //end for each task

    return { scheduledItems: newlyScheduledPurchases, unschedulableTasks };
  }

  private initializeRunState(
    runState: Map<string, Map<string, AccountDailyRunStatus>>,
    existingCommittedSchedule: ScheduledPurchase[],
    accountAvailability: AccountAvailability,
    allAccounts: Account[]
  ): void {
    // initialize with unavailability first
    for (const account of allAccounts) {
      runState.set(account.id, new Map());
      const availability = accountAvailability[account.id];
      if (availability?.unavailableDates) {
        for (const unavailableDate of availability.unavailableDates) {
          const dateStr = dateToDateString(unavailableDate);
          runState.get(account.id)!.set(dateStr, {
            purchaseCount: 0,
            booksPurchasedToday: new Set(),
            unavailable: true,
          });
        }
      }
    }

    //then layer existing commitments
    for (const purchase of existingCommittedSchedule) {
      if (purchase.status === "missed") continue; //don't count missed tasks against limits

      const dateStr = dateToDateString(purchase.purchaseDate);
      if (!runState.has(purchase.accountId)) {
        // should be pre-initialized, but defensive
        runState.set(purchase.accountId, new Map());
      }
      if (!runState.get(purchase.accountId)!.has(dateStr)) {
        runState.get(purchase.accountId)!.set(dateStr, {
          purchaseCount: 0,
          booksPurchasedToday: new Set(),
          unavailable: this.isAccountUnavailableOnDate(
            purchase.accountId,
            purchase.purchaseDate,
            accountAvailability
          ),
        });
      }

      const dailyStatus = runState.get(purchase.accountId)!.get(dateStr)!;
      // if it was marked unavailable but has a committed purchase, this is a conflict.
      // for now, we assume committed purchases override unavailability for initialization,
      // but this signals a data integrity issue if it happens.
      if (dailyStatus.unavailable) {
        this.logger.logWarning(
          `Account ${purchase.accountId} has a committed purchase on ${dateStr} but was marked unavailable. Honoring purchase for run state.`
        );
        dailyStatus.unavailable = false;
      }
      dailyStatus.purchaseCount++;
      dailyStatus.booksPurchasedToday.add(purchase.bookId);
    }
  }

  private isAccountUnavailableOnDate(
    accountId: string,
    date: Date,
    accountAvailability: AccountAvailability
  ): boolean {
    const availability = accountAvailability[accountId];
    if (availability?.unavailableDates) {
      const dateStr = dateToDateString(date);
      return availability.unavailableDates.some(
        (d) => dateToDateString(d) === dateStr
      );
    }
    return false;
  }

  /**
   * helper to convert Orders into a flat list of TasksToSchedule.
   * for when processing new orders.
   */
  public static ordersToTasks(orders: Order[]): TaskToSchedule[] {
    const tasks: TaskToSchedule[] = [];
    for (const order of orders) {
      for (const item of order.items) {
        tasks.push({
          reviewId: item.reviewId,
          bookId: item.bookId,
          orderId: order.id,
          clientId: order.clientId,
        });
      }
    }
    return tasks;
  }

  /**
   * helper to convert missed/delayed ScheduledPurchase items back into TasksToSchedule.
   * this is useful for rescheduling.
   */
  public static scheduledItemsToTasks(
    items: ScheduledPurchase[]
  ): TaskToSchedule[] {
    return items.map((item) => ({
      reviewId: item.reviewId,
      bookId: item.bookId,
      orderId: item.orderId,
      clientId: item.client,
      // one might add item.purchaseDate as 'originalScheduledDate' here if prioritization is needed
    }));
  }
}
