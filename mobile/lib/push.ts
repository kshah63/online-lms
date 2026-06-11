import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { supabase } from "./supabase";

// Foreground notification behaviour.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Register this device's Expo push token against the signed-in profile so the
 * web server (notify dispatcher) can push to it. Safe to call on every launch;
 * no-ops on simulators / web and when permission is denied. Requires an EAS
 * projectId (set extra.eas.projectId in app.json after `eas init`).
 */
export async function registerForPush(profileId: string): Promise<void> {
  try {
    if (!Device.isDevice) return;

    const current = await Notifications.getPermissionsAsync();
    let status = current.status;
    if (status !== "granted") {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== "granted") return;

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Default",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const projectId =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ||
      (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId;
    if (!projectId) return; // can't mint a token without an EAS project

    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    if (!token) return;

    await supabase.from("push_tokens").upsert(
      {
        token,
        profile_id: profileId,
        platform: Platform.OS,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "token" },
    );
  } catch {
    // Push is best-effort; never block sign-in on it.
  }
}
