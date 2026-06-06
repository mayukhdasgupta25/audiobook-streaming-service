/**
 * Date Formatter Utility
 * Provides date formatting functions, especially for IST timezone
 */

export function formatIST(date?: Date): string {
   const dateObj = date || new Date();
   const utcDate = new Date(dateObj.getTime());
   const istOffsetMinutes = 5 * 60 + 30;

   let year = utcDate.getUTCFullYear();
   let month = utcDate.getUTCMonth();
   let day = utcDate.getUTCDate();
   let hours = utcDate.getUTCHours();
   let minutes = utcDate.getUTCMinutes();
   const seconds = utcDate.getUTCSeconds();

   minutes += istOffsetMinutes;
   hours += Math.floor(minutes / 60);
   minutes = minutes % 60;

   if (hours >= 24) {
      hours -= 24;
      day += 1;
   }

   const daysInMonth = new Date(year, month + 1, 0).getDate();
   if (day > daysInMonth) {
      day = 1;
      month += 1;
   }

   if (month >= 12) {
      month = 0;
      year += 1;
   }

   const formattedMonth = String(month + 1).padStart(2, '0');
   const formattedDay = String(day).padStart(2, '0');
   const formattedHours = String(hours).padStart(2, '0');
   const formattedMinutes = String(minutes).padStart(2, '0');
   const formattedSeconds = String(seconds).padStart(2, '0');

   return `${year}-${formattedMonth}-${formattedDay} ${formattedHours}:${formattedMinutes}:${formattedSeconds}`;
}

export function getCurrentIST(): string {
   return formatIST();
}
