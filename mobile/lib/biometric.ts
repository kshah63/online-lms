import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

// Biometric unlock (Face ID / Touch ID / fingerprint). When enabled, the app
// gates access on cold start: the Supabase session stays signed in, but the UI
// stays locked until the device authenticates the user.

const KEY = "biometric_enabled";

/** Device has biometric hardware AND the user has enrolled (face/fingerprint). */
export async function isBiometricAvailable(): Promise<boolean> {
  try {
    const [hasHardware, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return hasHardware && enrolled;
  } catch {
    return false;
  }
}

export async function getBiometricEnabled(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(KEY)) === "1";
  } catch {
    return false;
  }
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  try {
    if (enabled) await SecureStore.setItemAsync(KEY, "1");
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    // non-fatal — the toggle just won't persist
  }
}

/** Prompt Face ID / fingerprint. Resolves true on success. */
export async function authenticate(): Promise<boolean> {
  try {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: "Unlock MathVision",
      cancelLabel: "Cancel",
    });
    return res.success;
  } catch {
    return false;
  }
}
