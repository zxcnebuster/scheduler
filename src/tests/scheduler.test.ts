import {
  PurchaseScheduler,
  MAX_PURCHASES_PER_ACCOUNT_PER_DAY,
  MIN_REVIEW_DELAY_DAYS,
  MAX_SCHEDULING_ATTEMPT_DAYS,
} from "../scheduler";
import {
  Account,
  Order,
  ScheduledPurchase,
  TaskToSchedule,
  AccountAvailability,
} from "../types";
import { dateToDateString, addDays, dateStringtoDate } from "../utils";

//create a UTC date for tests
const createUTCDate = (
  year: number,
  month: number,
  day: number,
  hours = 0,
  minutes = 0,
  seconds = 0
) => {
  return new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
};

describe("PurchaseScheduler", () => {
  let scheduler: PurchaseScheduler;
  let accounts: Account[];
  let today: Date;

  beforeEach(() => {
    scheduler = new PurchaseScheduler({
      logInfo: jest.fn(),
      logError: jest.fn(),
      logWarning: jest.fn(),
    }); //mock logger
    accounts = [
      { id: "acc1", name: "Account 1" },
      { id: "acc2", name: "Account 2" },
      { id: "acc3", name: "Account 3" },
    ];
    today = createUTCDate(2023, 10, 26); //thursday
  });

  //helper to make test data more concise
  const createTask = (
    reviewId: string,
    bookId: string,
    orderId = "order1",
    clientId = "client1"
  ): TaskToSchedule => ({
    reviewId,
    bookId,
    orderId,
    clientId,
  });

  it("should schedule a single task on the earliest possible day and account", () => {
    const tasks = [createTask("rev1", "bookA")];
    const { scheduledItems } = scheduler.generateSchedule(
      tasks,
      [],
      accounts,
      {},
      today
    );

    expect(scheduledItems).toHaveLength(1);
    const item = scheduledItems[0];
    expect(item.bookId).toBe("bookA");
    expect(dateToDateString(item.purchaseDate)).toBe(dateToDateString(today));
    expect(item.accountId).toBe("acc1"); //assumes acc1 is first and has 0 load
    expect(dateToDateString(item.reviewDate)).toBe(
      dateToDateString(addDays(today, MIN_REVIEW_DELAY_DAYS))
    );
  });

  it("should respect MAX_PURCHASES_PER_ACCOUNT_PER_DAY", () => {
    const tasks = [
      createTask("rev1", "bookA"),
      createTask("rev2", "bookB"),
      createTask("rev3", "bookC"),
      createTask("rev4", "bookD"), //this should go to acc2 or next day if only 1 acc
    ];
    const singleAccount = [{ id: "acc1", name: "Account 1" }];
    const { scheduledItems } = scheduler.generateSchedule(
      tasks,
      [],
      singleAccount,
      {},
      today
    );

    expect(scheduledItems).toHaveLength(4);
    //first 3 on acc1 today
    expect(
      scheduledItems.filter(
        (p) =>
          p.accountId === "acc1" &&
          dateToDateString(p.purchaseDate) === dateToDateString(today)
      )
    ).toHaveLength(MAX_PURCHASES_PER_ACCOUNT_PER_DAY);
    //4th on acc1, next day
    const fourthItem = scheduledItems.find((p) => p.reviewId === "rev4");
    expect(fourthItem?.accountId).toBe("acc1");
    expect(dateToDateString(fourthItem!.purchaseDate)).toBe(
      dateToDateString(addDays(today, 1))
    );
  });

  it("should distribute tasks across accounts to balance load for a single day", () => {
    const tasks = [
      createTask("rev1", "bookA"), //acc1
      createTask("rev2", "bookB"), //acc2
      createTask("rev3", "bookC"), //acc3
      createTask("rev4", "bookD"), //acc1
    ];
    const { scheduledItems } = scheduler.generateSchedule(
      tasks,
      [],
      accounts,
      {},
      today
    );

    expect(scheduledItems).toHaveLength(4);
    expect(scheduledItems[0].accountId).toBe("acc1");
    expect(scheduledItems[1].accountId).toBe("acc2");
    expect(scheduledItems[2].accountId).toBe("acc3");
    expect(scheduledItems[3].accountId).toBe("acc1"); //back to acc1 as it's least loaded among those with 1 purchase
    scheduledItems.forEach((item) =>
      expect(dateToDateString(item.purchaseDate)).toBe(dateToDateString(today))
    );
  });

  it("should not schedule the same book on the same account on the same day", () => {
    const tasks = [
      createTask("rev1", "bookA"), //acc1, today
      createTask("rev2", "bookA"), //should be acc2, today OR acc1, tomorrow
    ];
    const { scheduledItems } = scheduler.generateSchedule(
      tasks,
      [],
      accounts,
      {},
      today
    );

    expect(scheduledItems).toHaveLength(2);
    const item1 = scheduledItems.find((p) => p.reviewId === "rev1")!;
    const item2 = scheduledItems.find((p) => p.reviewId === "rev2")!;

    expect(item1.accountId).toBe("acc1");
    expect(dateToDateString(item1.purchaseDate)).toBe(dateToDateString(today));

    //item2 should be on a different account today, or same account next day
    if (item2.accountId === item1.accountId) {
      expect(dateToDateString(item2.purchaseDate)).toBe(
        dateToDateString(addDays(today, 1))
      );
    } else {
      expect(dateToDateString(item2.purchaseDate)).toBe(
        dateToDateString(today)
      );
      expect(item2.accountId).not.toBe(item1.accountId);
    }
    // with 3 accounts, it should go to acc2 on the same day
    expect(item2.accountId).toBe("acc2");
    expect(dateToDateString(item2.purchaseDate)).toBe(dateToDateString(today));
  });

  it("should correctly calculate review date (min 4 days after purchase)", () => {
    const tasks = [createTask("rev1", "bookA")];
    const { scheduledItems } = scheduler.generateSchedule(
      tasks,
      [],
      accounts,
      {},
      today
    );

    expect(scheduledItems).toHaveLength(1);
    const purchaseDate = scheduledItems[0].purchaseDate;
    const reviewDate = scheduledItems[0].reviewDate;

    const diffTime = Math.abs(reviewDate.getTime() - purchaseDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    expect(diffDays).toBe(MIN_REVIEW_DELAY_DAYS);
    const expectedReviewDate = addDays(
      new Date(purchaseDate),
      MIN_REVIEW_DELAY_DAYS
    );
    expect(dateToDateString(reviewDate)).toBe(
      dateToDateString(expectedReviewDate)
    );
  });

  it("should respect account unavailability", () => {
    const accountAvailability: AccountAvailability = {
      acc1: { unavailableDates: [today] },
      acc2: { unavailableDates: [addDays(today, 1)] },
    };
    const tasks = [
      createTask("rev1", "bookA"), //should go to acc2 today (acc1 unavailable)
      createTask("rev2", "bookB"), //should go to acc3 today (acc1 unavailable)
      createTask("rev3", "bookC"), //should go to acc2 today (acc1 unavailable)
    ];
    const { scheduledItems } = scheduler.generateSchedule(
      tasks,
      [],
      accounts,
      accountAvailability,
      today
    );

    expect(scheduledItems).toHaveLength(3);
    expect(scheduledItems[0].accountId).toBe("acc2");
    expect(dateToDateString(scheduledItems[0].purchaseDate)).toBe(
      dateToDateString(today)
    );
    expect(scheduledItems[1].accountId).toBe("acc3");
    expect(dateToDateString(scheduledItems[1].purchaseDate)).toBe(
      dateToDateString(today)
    );
    expect(scheduledItems[2].accountId).toBe("acc2"); // acc2 again
    expect(dateToDateString(scheduledItems[2].purchaseDate)).toBe(
      dateToDateString(today)
    );

    const tasksForNextDay = [createTask("rev4", "bookD")]; // try to schedule for tomorrow
    const { scheduledItems: nextDayItems } = scheduler.generateSchedule(
      tasksForNextDay,
      scheduledItems,
      accounts,
      accountAvailability,
      addDays(today, 1)
    );

    //an next day (today+1), acc1 is available, acc2 is NOT.
    expect(nextDayItems).toHaveLength(1);
    expect(nextDayItems[0].accountId).toBe("acc1"); //acc1 is available, acc2 is unavailable
    expect(dateToDateString(nextDayItems[0].purchaseDate)).toBe(
      dateToDateString(addDays(today, 1))
    );
  });

  it("should return unschedulable tasks if no slot is found within MAX_SCHEDULING_ATTEMPT_DAYS", () => {
    const singleAccount = [{ id: "acc1", name: "Account 1" }];
    const accountAvailability: AccountAvailability = {
      acc1: { unavailableDates: [] },
    };
    //make acc1 unavailable for MAX_SCHEDULING_ATTEMPT_DAYS + buffer
    for (let i = 0; i < MAX_SCHEDULING_ATTEMPT_DAYS + 5; i++) {
      accountAvailability["acc1"].unavailableDates?.push(addDays(today, i));
    }

    const tasks = [createTask("rev1", "bookA")];
    const { scheduledItems, unschedulableTasks } = scheduler.generateSchedule(
      tasks,
      [],
      singleAccount,
      accountAvailability,
      today
    );

    expect(scheduledItems).toHaveLength(0);
    expect(unschedulableTasks).toHaveLength(1);
    expect(unschedulableTasks[0].reviewId).toBe("rev1");
  });

  it("should consider existing committed schedule and apply load balancing", () => {
    // Renamed for clarity
    const existingSchedule: ScheduledPurchase[] = [
      {
        purchaseId: "exist1",
        reviewId: "exist1",
        orderId: "order0",
        bookId: "bookX",
        accountId: "acc1",
        purchaseDate: today,
        reviewDate: addDays(today, MIN_REVIEW_DELAY_DAYS),
        status: "pending",
      },
      {
        purchaseId: "exist2",
        reviewId: "exist2",
        orderId: "order0",
        bookId: "bookY",
        accountId: "acc1",
        purchaseDate: today,
        reviewDate: addDays(today, MIN_REVIEW_DELAY_DAYS),
        status: "pending",
      },
      //acc1 has 2 purchases today. load for today: acc1=2, acc2=0, acc3=0
    ];

    const tasks = [
      createTask("rev1", "bookA"), //expected: acc2 (load 0 vs acc1's 2)
      createTask("rev2", "bookB"), //expected: acc3 (load 0 vs acc1's 2, acc2's 1)
    ];

    const { scheduledItems } = scheduler.generateSchedule(
      tasks,
      existingSchedule,
      accounts,
      {},
      today
    );
    expect(scheduledItems).toHaveLength(2);

    const item1 = scheduledItems.find((p) => p.reviewId === "rev1")!;
    const item2 = scheduledItems.find((p) => p.reviewId === "rev2")!;

    //after rev1 is scheduled on acc2: load for today: acc1=2, acc2=1 (booka), acc3=0
    //after rev2 is scheduled on acc3: load for today: acc1=2, acc2=1 (booka), acc3=1 (bookb)

    expect(item1.accountId).toBe("acc2"); //corrected
    expect(dateToDateString(item1.purchaseDate)).toBe(dateToDateString(today));

    expect(item2.accountId).toBe("acc3"); //corrected
    expect(dateToDateString(item2.purchaseDate)).toBe(dateToDateString(today));
  });

  it("should log a warning and allow scheduling on account if existing purchase overrides unavailability", () => {
    const mockLogger = {
      logInfo: jest.fn(),
      logError: jest.fn(),
      logWarning: jest.fn(),
    };
    //re-initialize scheduler with the mock logger for this specific test
    const localScheduler = new PurchaseScheduler(mockLogger);

    const purchaseDate = today;
    const existingSchedule: ScheduledPurchase[] = [
      {
        purchaseId: "exist1",
        reviewId: "exist1",
        orderId: "order0",
        bookId: "bookX",
        accountId: "acc1",
        purchaseDate,
        reviewDate: addDays(purchaseDate, MIN_REVIEW_DELAY_DAYS),
        status: "pending",
      },
    ];
    //mark acc1 unavailable on the day of its existing purchase
    const accountAvailability: AccountAvailability = {
      acc1: { unavailableDates: [purchaseDate] },
    };

    //tasks that would fill up acc1 if it's considered available after override
    //acc1 starts with 1 existing purchase ('bookx').
    const tasks = [
      createTask("fill1", "bookF1"), //should go to acc1 (total 2 for acc1 today: bookx, bookf1)
      createTask("fill2", "bookF2"), //should go to acc1 (total 3 for acc1 today: bookx, bookf1, bookf2)
      createTask("overflow", "bookOF"), //should go to acc2 (acc1 full for today)
    ];

    const { scheduledItems } = localScheduler.generateSchedule(
      tasks,
      existingSchedule,
      accounts,
      accountAvailability,
      today
    );

    expect(mockLogger.logWarning).toHaveBeenCalledWith(
      `Account acc1 has a committed purchase on ${dateToDateString(
        purchaseDate
      )} but was marked unavailable. Honoring purchase for run state.`
    );

    const fill1Item = scheduledItems.find((item) => item.reviewId === "fill1");
    const fill2Item = scheduledItems.find((item) => item.reviewId === "fill2");
    const overflowItem = scheduledItems.find(
      (item) => item.reviewId === "overflow"
    );

    expect(fill1Item?.accountId).toBe("acc1");
    expect(dateToDateString(fill1Item!.purchaseDate)).toBe(
      dateToDateString(today)
    );

    expect(fill2Item?.accountId).toBe("acc1");
    expect(dateToDateString(fill2Item!.purchaseDate)).toBe(
      dateToDateString(today)
    );

    expect(overflowItem?.accountId).toBe("acc2"); //because acc1 is full for today (1 existing + 2 new)
    expect(dateToDateString(overflowItem!.purchaseDate)).toBe(
      dateToDateString(today)
    );
  });

  it('should correctly use the provided "today" parameter as starting date', () => {
    const futureDate = addDays(today, 10);
    const tasks = [createTask("rev1", "bookA")];
    const { scheduledItems } = scheduler.generateSchedule(
      tasks,
      [],
      accounts,
      {},
      futureDate
    );

    expect(scheduledItems).toHaveLength(1);
    expect(dateToDateString(scheduledItems[0].purchaseDate)).toBe(
      dateToDateString(futureDate)
    );
  });

  describe("Static Helper: ordersToTasks", () => {
    it("should convert orders to a flat list of tasks", () => {
      const orders: Order[] = [
        {
          id: "order1",
          clientId: "clientA",
          createdAt: new Date(),
          items: [
            { reviewId: "revA1", bookId: "bookA" },
            { reviewId: "revA2", bookId: "bookB" },
          ],
        },
        {
          id: "order2",
          clientId: "clientB",
          createdAt: new Date(),
          items: [{ reviewId: "revB1", bookId: "bookC" }],
        },
      ];
      const tasks = PurchaseScheduler.ordersToTasks(orders);
      expect(tasks).toHaveLength(3);
      expect(tasks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            reviewId: "revA1",
            bookId: "bookA",
            orderId: "order1",
            clientId: "clientA",
          }),
          expect.objectContaining({
            reviewId: "revA2",
            bookId: "bookB",
            orderId: "order1",
            clientId: "clientA",
          }),
          expect.objectContaining({
            reviewId: "revB1",
            bookId: "bookC",
            orderId: "order2",
            clientId: "clientB",
          }),
        ])
      );
    });
  });

  describe("Static Helper: scheduledItemsToTasks", () => {
    it("should convert scheduled items back to tasks for rescheduling", () => {
      const scheduledItems: ScheduledPurchase[] = [
        {
          purchaseId: "p1",
          reviewId: "rev1",
          orderId: "o1",
          bookId: "b1",
          accountId: "a1",
          purchaseDate: today,
          reviewDate: addDays(today, 4),
          status: "missed",
          client: "c1",
        },
        {
          purchaseId: "p2",
          reviewId: "rev2",
          orderId: "o2",
          bookId: "b2",
          accountId: "a2",
          purchaseDate: addDays(today, 1),
          reviewDate: addDays(today, 5),
          status: "delayed",
          client: "c2",
        },
      ];
      const tasks = PurchaseScheduler.scheduledItemsToTasks(scheduledItems);
      expect(tasks).toHaveLength(2);
      expect(tasks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            reviewId: "rev1",
            bookId: "b1",
            orderId: "o1",
            clientId: "c1",
          }),
          expect.objectContaining({
            reviewId: "rev2",
            bookId: "b2",
            orderId: "o2",
            clientId: "c2",
          }),
        ])
      );
    });
  });

  it("should handle edge case of no accounts", () => {
    const tasks = [createTask("rev1", "bookA")];
    const { scheduledItems, unschedulableTasks } = scheduler.generateSchedule(
      tasks,
      [],
      [],
      {},
      today
    );
    expect(scheduledItems).toHaveLength(0);
    expect(unschedulableTasks).toHaveLength(1);
    expect(unschedulableTasks[0].reviewId).toBe("rev1");
  });

  it("should handle edge case of no tasks", () => {
    const { scheduledItems, unschedulableTasks } = scheduler.generateSchedule(
      [],
      [],
      accounts,
      {},
      today
    );
    expect(scheduledItems).toHaveLength(0);
    expect(unschedulableTasks).toHaveLength(0);
  });

  it("complex scenario: multiple books, account limits, and day rollover", () => {
    //acc1, acc2. Max 3 per day.
    const twoAccounts = accounts.slice(0, 2);
    const tasks = [
      createTask("r1", "bA"), //acc1, today
      createTask("r2", "bB"), //acc2, today
      createTask("r3", "bC"), //acc1, today
      createTask("r4", "bD"), //acc2, today
      createTask("r5", "bE"), //acc1, today
      createTask("r6", "bF"), //acc2, today (acc1 & acc2 full for today)
      createTask("r7", "bG"), //acc1, tomorrow
      createTask("r8", "bH"), //acc2, tomorrow
    ];

    const { scheduledItems, unschedulableTasks } = scheduler.generateSchedule(
      tasks,
      [],
      twoAccounts,
      {},
      today
    );
    expect(unschedulableTasks).toHaveLength(0);
    expect(scheduledItems).toHaveLength(8);

    const todayStr = dateToDateString(today);
    const tomorrowStr = dateToDateString(addDays(today, 1));

    const todayItems = scheduledItems.filter(
      (item) => dateToDateString(item.purchaseDate) === todayStr
    );
    const tomorrowItems = scheduledItems.filter(
      (item) => dateToDateString(item.purchaseDate) === tomorrowStr
    );

    expect(todayItems).toHaveLength(6);
    expect(tomorrowItems).toHaveLength(2);

    expect(todayItems.filter((item) => item.accountId === "acc1")).toHaveLength(
      3
    );
    expect(todayItems.filter((item) => item.accountId === "acc2")).toHaveLength(
      3
    );

    expect(
      tomorrowItems.filter((item) => item.accountId === "acc1")
    ).toHaveLength(1); // r7
    expect(
      tomorrowItems.find((item) => item.reviewId === "r7")?.accountId
    ).toBe("acc1");
    expect(
      tomorrowItems.filter((item) => item.accountId === "acc2")
    ).toHaveLength(1); // r8
    expect(
      tomorrowItems.find((item) => item.reviewId === "r8")?.accountId
    ).toBe("acc2");
  });
});
