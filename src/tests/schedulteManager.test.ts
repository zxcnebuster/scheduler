import { ScheduleManager } from "../scheduleManager";
import {
  Account,
  Order,
  ScheduledPurchase,
  AccountAvailability,
  PurchaseStatus,
} from "../types";
import { dateToDateString, addDays } from "../utils";

const createUTCDate = (year: number, month: number, day: number) => {
  return new Date(Date.UTC(year, month - 1, day));
};

describe("ScheduleManager", () => {
  let manager: ScheduleManager;
  let accounts: Account[];
  let today: Date;

  beforeEach(() => {
    accounts = [
      { id: "acc1", name: "Account 1" },
      { id: "acc2", name: "Account 2" },
    ];
    today = createUTCDate(2023, 10, 27); // A new day
    manager = new ScheduleManager(accounts, {});
  });

  const createOrder = (
    orderId: string,
    ...bookReviewPairs: { reviewId: string; bookId: string }[]
  ): Order => ({
    id: orderId,
    clientId: `client-${orderId}`,
    createdAt: today,
    items: bookReviewPairs.map((pair) => ({
      reviewId: pair.reviewId,
      bookId: pair.bookId,
    })),
  });

  it("should initialize with accounts and empty schedule", () => {
    expect(manager.getFullSchedule()).toEqual([]);
    expect(manager.getAuditLog().length).toBeGreaterThan(0);
  });

  it("should add new orders and schedule them", () => {
    const order1 = createOrder("o1", { reviewId: "r1", bookId: "bA" });
    manager.addNewOrders([order1], today);

    const schedule = manager.getFullSchedule();
    expect(schedule).toHaveLength(1);
    expect(schedule[0].reviewId).toBe("r1");
    expect(dateToDateString(schedule[0].purchaseDate)).toBe(
      dateToDateString(today)
    );
  });

  it("should mark a purchase as missed and reschedule it", () => {
    const order1 = createOrder("o1", { reviewId: "r1", bookId: "bA" }); // -> acc1, today
    manager.addNewOrders([order1], today);

    let schedule = manager.getFullSchedule();
    const purchaseIdToMiss = schedule[0].purchaseId;

    manager.markPurchaseStatus(
      purchaseIdToMiss,
      "missed",
      "Operator missed it",
      today
    );

    schedule = manager.getFullSchedule();
    expect(schedule).toHaveLength(1);
    const rescheduledItem = schedule[0];

    expect(rescheduledItem.reviewId).toBe("r1");
    expect(rescheduledItem.status).toBe("pending");

    expect(dateToDateString(rescheduledItem.purchaseDate)).toBe(
      dateToDateString(today)
    );
    expect(rescheduledItem.accountId).toBe("acc1");
    expect(
      manager
        .getAuditLog()
        .some(
          (log) =>
            log.action === "TASK_FLAGGED_FOR_RESCHEDULE" &&
            log.details.purchaseId === purchaseIdToMiss
        )
    ).toBe(true);
  });

  it("should reschedule tasks if an account becomes unavailable", () => {
    const order1 = createOrder("o1", { reviewId: "r1", bookId: "bA" }); // -> acc1, today
    const order2 = createOrder("o2", { reviewId: "r2", bookId: "bB" }); // -> acc2, today
    const order3 = createOrder("o3", { reviewId: "r3", bookId: "bC" }); // -> acc1, today (2nd for acc1)
    manager.addNewOrders([order1, order2, order3], today);

    let schedule = manager.getFullSchedule();
    expect(schedule.find((p) => p.reviewId === "r1")?.accountId).toBe("acc1");
    expect(schedule.find((p) => p.reviewId === "r2")?.accountId).toBe("acc2");
    expect(schedule.find((p) => p.reviewId === "r3")?.accountId).toBe("acc1");

    manager.setAccountAvailability("acc1", [today]);

    schedule = manager.getFullSchedule();
    const r1Item = schedule.find((p) => p.reviewId === "r1")!;
    const r2Item = schedule.find((p) => p.reviewId === "r2")!; // Unchanged
    const r3Item = schedule.find((p) => p.reviewId === "r3")!;

    expect(r1Item.accountId).toBe("acc2");
    expect(dateToDateString(r1Item.purchaseDate)).toBe(dateToDateString(today));

    expect(r2Item.accountId).toBe("acc2");
    expect(dateToDateString(r2Item.purchaseDate)).toBe(dateToDateString(today));

    expect(r3Item.accountId).toBe("acc1");
    expect(dateToDateString(r3Item.purchaseDate)).toBe(
      dateToDateString(addDays(today, 1))
    );

    expect(
      manager
        .getAuditLog()
        .some((log) => log.action === "ACCOUNT_AVAILABILITY_UPDATED")
    ).toBe(true);
    expect(
      manager
        .getAuditLog()
        .filter((log) => log.action === "TASK_FLAGGED_FOR_RESCHEDULE").length
    ).toBe(2);
  });

  it("should handle marking a task as completed", () => {
    const order1 = createOrder("o1", { reviewId: "r1", bookId: "bA" });
    manager.addNewOrders([order1], today);
    const purchaseId = manager.getFullSchedule()[0].purchaseId;

    manager.markPurchaseStatus(purchaseId, "completed");
    const schedule = manager.getFullSchedule();
    expect(schedule[0].status).toBe("completed");

    expect(
      manager
        .getAuditLog()
        .filter((log) => log.action === "TASK_FLAGGED_FOR_RESCHEDULE").length
    ).toBe(0);
  });

  it("should correctly remove unavailable dates when setting availability", () => {
    const unavailableDate1 = createUTCDate(2023, 11, 1);
    const unavailableDate2 = createUTCDate(2023, 11, 2);

    manager.setAccountAvailability("acc1", [
      unavailableDate1,
      unavailableDate2,
    ]);
    let acc1Availability = (manager as any).accountAvailability[
      "acc1"
    ].unavailableDates.map(dateToDateString);
    expect(acc1Availability).toContain(dateToDateString(unavailableDate1));
    expect(acc1Availability).toContain(dateToDateString(unavailableDate2));

    manager.setAccountAvailability("acc1", []);
    acc1Availability = (manager as any).accountAvailability[
      "acc1"
    ].unavailableDates.map(dateToDateString);
    expect(acc1Availability).not.toContain(dateToDateString(unavailableDate1));
    expect(acc1Availability).toContain(dateToDateString(unavailableDate2));

    manager.setAccountAvailability("acc1", []);
    acc1Availability = (manager as any).accountAvailability[
      "acc1"
    ].unavailableDates.map(dateToDateString);
    expect(acc1Availability).not.toContain(dateToDateString(unavailableDate1));
    expect(acc1Availability).not.toContain(dateToDateString(unavailableDate2));
    expect(acc1Availability).toHaveLength(0);
  });
});
