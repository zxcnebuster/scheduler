import { dateToDateString, addDays, dateStringtoDate } from "../utils";

describe("Utility Functions", () => {
  describe("dateToDateString", () => {
    it("should format date as YYYY-MM-DD string in UTC", () => {
      const date = new Date(Date.UTC(2023, 9, 5)); //oct 5, 2023 (month is 0-indexed)
      expect(dateToDateString(date)).toBe("2023-10-05");
    });

    it("should handle single digit month/day by padding with zero", () => {
      const date = new Date(Date.UTC(2023, 0, 1)); //jan 1, 2023
      expect(dateToDateString(date)).toBe("2023-01-01");
    });
  });

  describe("addDays", () => {
    it("should add days to a date, preserving UTC date parts", () => {
      const date = new Date(Date.UTC(2023, 9, 26)); //oct 26
      const newDate = addDays(date, 5);
      expect(newDate.getUTCFullYear()).toBe(2023);
      expect(newDate.getUTCMonth()).toBe(9); //october
      expect(newDate.getUTCDate()).toBe(31);
    });

    it("should roll over to next month/year correctly", () => {
      const date = new Date(Date.UTC(2023, 9, 30)); //oct 30
      const newDate = addDays(date, 3); //expect nov 2
      expect(dateToDateString(newDate)).toBe("2023-11-02");

      const date2 = new Date(Date.UTC(2023, 11, 30)); //dec 30
      const newDate2 = addDays(date2, 3); //expect jan 2, 2024
      expect(dateToDateString(newDate2)).toBe("2024-01-02");
    });
  });

  describe("dateStringtoDate", () => {
    it("should convert YYYY-MM-DD string to a UTC Date object at midnight", () => {
      const dateStr = "2023-10-26";
      const date = dateStringtoDate(dateStr);
      expect(date.getUTCFullYear()).toBe(2023);
      expect(date.getUTCMonth()).toBe(9); //october (0-indexed)
      expect(date.getUTCDate()).toBe(26);
      expect(date.getUTCHours()).toBe(0);
      expect(date.getUTCMinutes()).toBe(0);
      expect(date.getUTCSeconds()).toBe(0);
      expect(date.getUTCMilliseconds()).toBe(0);
    });

    it("should correctly parse months and days from string", () => {
      const dateStr = "2023-01-05";
      const date = dateStringtoDate(dateStr);
      expect(date.getUTCMonth()).toBe(0); //january
      expect(date.getUTCDate()).toBe(5);
    });
  });
});
