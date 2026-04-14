// utils/notify.js
import * as Notifications from "expo-notifications";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,  // show notification as banner
    shouldShowList: true,    // show in notification center / list
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function requestNotifPermission() {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

/**
 * Schedule a DAILY local notification at a given hour/minute (24h clock).
 *
 * Examples:
 *   scheduleDailyReminder(20, 0)  ->  8:00 PM every day
 *   scheduleDailyReminder(6, 30)  ->  6:30 AM every day
 */
export async function scheduleDailyReminder(hour = 20, minute = 0) {
  try {
    // Optional: clear existing scheduled notifications so we don't stack multiples
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (e) {
    console.log("[notify] cancelAllScheduledNotificationsAsync failed:", e);
  }

  return Notifications.scheduleNotificationAsync({
    content: {
      title: "AI Fitness Coach",
      body: "Time to check in with your coach or review your plan!",
    },
    trigger: {
      hour,
      minute,
      repeats: true, // daily at that hour/minute
    },
  });
}
