import { LinearGradient } from "expo-linear-gradient";
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  Clock3,
  Lock,
  ShieldCheck,
  Star,
  X,
} from "lucide-react-native";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import RazorpayCheckout from "react-native-razorpay";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { apiV1 } from "../services/api";
import { userService } from "../services/userService";
import ErrorBoundary from "../ui/ErrorBoundary";
import logger from "../utils/logger";

type PaymentStep = "OFFER" | "PROCESSING" | "PENDING" | "SUCCESS" | "FAILED";

type RouteParams = {
  artistId?: string | number;
  artistName?: string;
  contentId?: string | number;
  artwork?: string;
};

type PurchaseResponse = {
  success: boolean;
  subscription: {
    id: number;
    artistId: number;
    artistName: string;
    status: "PENDING";
  };
  order: {
    id: string;
    amount: number;
    currency: string;
    key_id: string;
  };
};

type PurchaseStatusResponse = {
  success: boolean;
  subscription: {
    id: number;
    artistId: number;
    artistName: string;
    status: string;
    expiresAt?: string | null;
  };
  payment?: {
    status: string;
    failureReason?: string | null;
  } | null;
};

const POLL_INTERVAL_MS = 2_000;
const INITIAL_CONFIRMATION_WINDOW_MS = 45_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatPriceFromPaise(amountPaise: number, currency = "INR") {
  const amount = amountPaise / 100;
  if (currency.toUpperCase() === "INR") {
    return `₹${Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(2)}`;
  }
  return `${currency.toUpperCase()} ${amount.toFixed(2)}`;
}

export default function SubscriptionFlowScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const params: RouteParams = route?.params ?? {};
  const artistId = useMemo(() => Number(params.artistId), [params.artistId]);
  const contentId = params.contentId;

  const [artistName, setArtistName] = useState(
    String(params.artistName || "Artist")
  );
  const [displayPrice, setDisplayPrice] = useState<number | null>(null);
  const [step, setStep] = useState<PaymentStep>("OFFER");
  const [subscriptionId, setSubscriptionId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [failureReason, setFailureReason] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isProfileLoading, setIsProfileLoading] = useState(true);
  const [lastKnownExpiry, setLastKnownExpiry] = useState<string | null>(null);

  const fade = useRef(new Animated.Value(0)).current;
  const pollingGeneration = useRef(0);

  const hasValidArtist = Number.isSafeInteger(artistId) && artistId > 0;

  useEffect(() => {
    Animated.timing(fade, {
      toValue: 1,
      duration: 350,
      useNativeDriver: true,
    }).start();
  }, [fade]);

  useEffect(() => {
    let cancelled = false;

    const loadArtist = async () => {
      if (!hasValidArtist) {
        setErrorMessage("Artist information is missing. Please return and try again.");
        setIsProfileLoading(false);
        return;
      }

      setIsProfileLoading(true);
      try {
        const profile = await userService.getArtistProfile(artistId);
        if (cancelled) return;

        if (!profile) {
          setErrorMessage("Unable to load this artist's subscription details.");
          return;
        }

        setArtistName(profile.name || artistName);
        const price = Number(profile.subscriptionPrice);
        setDisplayPrice(Number.isFinite(price) && price > 0 ? price : null);
        if (!Number.isFinite(price) || price <= 0) {
          setErrorMessage("This artist is not currently accepting subscriptions.");
        }
      } catch {
        if (!cancelled) {
          setErrorMessage("Unable to load subscription details. Please try again.");
        }
      } finally {
        if (!cancelled) setIsProfileLoading(false);
      }
    };

    void loadArtist();
    return () => {
      cancelled = true;
      pollingGeneration.current += 1;
    };
  }, [artistId, artistName, hasValidArtist]);

  const fetchStatus = async (id: number): Promise<PurchaseStatusResponse> => {
    const response = await apiV1.get(`/subscriptions/${id}`);
    return response.data as PurchaseStatusResponse;
  };

  const applyTerminalStatus = (status: PurchaseStatusResponse) => {
    const subscriptionStatus = String(status.subscription?.status || "").toUpperCase();
    const paymentStatus = String(status.payment?.status || "").toUpperCase();

    if (subscriptionStatus === "ACTIVE") {
      setLastKnownExpiry(status.subscription?.expiresAt || null);
      setStep("SUCCESS");
      setFailureReason(null);
      return true;
    }

    if (paymentStatus === "FAILED") {
      setFailureReason(
        status.payment?.failureReason || "The payment was not completed."
      );
      setStep("FAILED");
      return true;
    }

    return false;
  };

  const pollUntilSettled = async (
    id: number,
    windowMs = INITIAL_CONFIRMATION_WINDOW_MS
  ) => {
    const generation = ++pollingGeneration.current;
    const deadline = Date.now() + windowMs;

    while (Date.now() < deadline && generation === pollingGeneration.current) {
      try {
        const status = await fetchStatus(id);
        if (generation !== pollingGeneration.current) return;
        if (applyTerminalStatus(status)) return;
      } catch (error: any) {
        logger.warn(
          "[SubscriptionFlow] status poll failed",
          error?.response?.status || error?.message
        );
      }

      await sleep(POLL_INTERVAL_MS);
    }

    if (generation === pollingGeneration.current) {
      setStep("PENDING");
    }
  };

  const startPayment = async () => {
    if (isStarting || !hasValidArtist) return;

    setErrorMessage(null);
    setFailureReason(null);
    setIsStarting(true);

    try {
      const response = await apiV1.post<PurchaseResponse>("/subscriptions", {
        artistId,
      });
      const purchase = response.data;
      const id = Number(purchase?.subscription?.id);
      const orderId = String(purchase?.order?.id || "").trim();
      const amount = Number(purchase?.order?.amount);
      const currency = String(purchase?.order?.currency || "INR").toUpperCase();
      const key = String(
        purchase?.order?.key_id || process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID || ""
      ).trim();

      if (
        !Number.isSafeInteger(id) ||
        id <= 0 ||
        !orderId ||
        !Number.isSafeInteger(amount) ||
        amount <= 0 ||
        !key
      ) {
        throw new Error("The server returned an invalid payment order.");
      }

      setSubscriptionId(id);
      setArtistName(purchase.subscription.artistName || artistName);
      setDisplayPrice(amount / 100);

      if (Platform.OS === "web") {
        throw new Error("This Phase-1 fan payment flow is available in the mobile app.");
      }

      let gatewayResult: any;
      try {
        gatewayResult = await RazorpayCheckout.open({
          key,
          amount,
          currency,
          name: "Music Platform",
          description: `Monthly subscription · ${purchase.subscription.artistName}`,
          order_id: orderId,
          notes: {
            subscription_id: String(id),
            artist_id: String(purchase.subscription.artistId),
          },
          theme: { color: "#FF7A18" },
        } as any);
      } catch (error: any) {
        const text = String(
          error?.description || error?.error?.description || error?.message || ""
        );

        // Cancellation is not payment truth. Do not tell the backend to mark a
        // transaction failed; Razorpay webhook/reconciliation owns that state.
        if (/cancel/i.test(text) || text.includes("payment_error")) {
          setStep("OFFER");
          Alert.alert(
            "Payment not completed",
            "No subscription access was activated. You can try again whenever you're ready."
          );
          return;
        }
        throw error;
      }

      logger.log("[SubscriptionFlow] gateway returned", {
        orderId: gatewayResult?.razorpay_order_id || orderId,
        hasPaymentId: Boolean(gatewayResult?.razorpay_payment_id),
      });

      // The SDK callback is only a signal that checkout returned. It is NOT
      // sufficient to unlock content. Verified webhook state remains authoritative.
      setStep("PROCESSING");
      await pollUntilSettled(id);
    } catch (error: any) {
      const serverMessage = error?.response?.data?.message;
      const message =
        serverMessage ||
        error?.message ||
        "Unable to start subscription. Please try again.";
      setErrorMessage(String(message));
      setStep("OFFER");
    } finally {
      setIsStarting(false);
    }
  };

  const checkAgain = async () => {
    if (!subscriptionId) {
      setStep("OFFER");
      return;
    }

    setStep("PROCESSING");
    try {
      const status = await fetchStatus(subscriptionId);
      if (applyTerminalStatus(status)) return;
      await pollUntilSettled(subscriptionId, 20_000);
    } catch (error: any) {
      setErrorMessage(
        error?.response?.data?.message ||
          "We couldn't refresh payment status. Please try again."
      );
      setStep("PENDING");
    }
  };

  const goToArtist = () => {
    navigation.navigate("Artist", {
      artistId: String(artistId),
      unlocked: true,
      contentId,
    });
  };

  const close = () => {
    pollingGeneration.current += 1;
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("Home");
  };

  const offerPrice = displayPrice
    ? `₹${Number.isInteger(displayPrice) ? displayPrice.toFixed(0) : displayPrice.toFixed(2)}`
    : "—";

  return (
    <ErrorBoundary label="Payments: Artist Subscription">
      <View style={styles.root}>
        <LinearGradient
          colors={["#080808", "#15100D", "#080808"]}
          style={StyleSheet.absoluteFillObject}
        />
        <SafeAreaView style={styles.safe}>
          {step === "OFFER" && (
            <ScrollView
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              <Animated.View style={{ opacity: fade }}>
                <View style={styles.heroIcon}>
                  <Star color="#fff" size={28} fill="#fff" />
                </View>
                <Text style={styles.eyebrow}>EARLY ACCESS MEMBERSHIP</Text>
                <Text style={styles.title}>Support {artistName}</Text>
                <Text style={styles.subtitle}>
                  Get 30 days of access to this artist's subscriber-only early releases.
                </Text>

                <View style={styles.card}>
                  <View style={styles.priceRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>Monthly Artist Access</Text>
                      <Text style={styles.cardSub}>Fixed 30-day access · manual renewal</Text>
                    </View>
                    {isProfileLoading ? (
                      <ActivityIndicator color="#FF7A18" />
                    ) : (
                      <View style={styles.priceBlock}>
                        <Text style={styles.price}>{offerPrice}</Text>
                        <Text style={styles.perMonth}>/30 days</Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.divider} />
                  {[
                    "Early access to subscriber releases",
                    "Exclusive artist content",
                    "Directly support the artist",
                    "No automatic renewal in Phase 1",
                  ].map((item) => (
                    <View key={item} style={styles.benefitRow}>
                      <View style={styles.checkCircle}>
                        <Check color="#FF7A18" size={13} strokeWidth={3} />
                      </View>
                      <Text style={styles.benefitText}>{item}</Text>
                    </View>
                  ))}
                </View>

                {errorMessage && (
                  <View style={styles.errorBox}>
                    <AlertTriangle color="#EF4444" size={18} />
                    <Text style={styles.errorText}>{errorMessage}</Text>
                  </View>
                )}

                <Pressable
                  onPress={startPayment}
                  disabled={isStarting || isProfileLoading || !displayPrice}
                  style={[
                    styles.ctaWrap,
                    (isStarting || isProfileLoading || !displayPrice) && styles.disabled,
                  ]}
                >
                  <LinearGradient
                    colors={["#FF7A18", "#FF3D00"]}
                    style={styles.cta}
                  >
                    {isStarting ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Lock color="#fff" size={18} />
                        <Text style={styles.ctaText}>Subscribe · {offerPrice}</Text>
                      </>
                    )}
                  </LinearGradient>
                </Pressable>

                <View style={styles.trustRow}>
                  <ShieldCheck color="rgba(255,255,255,0.48)" size={15} />
                  <Text style={styles.trustText}>
                    Secure Razorpay checkout · Access unlocks only after server confirmation
                  </Text>
                </View>
              </Animated.View>
            </ScrollView>
          )}

          {step === "PROCESSING" && (
            <View style={styles.centered}>
              <ActivityIndicator color="#FF7A18" size="large" />
              <Text style={styles.stateTitle}>Confirming payment…</Text>
              <Text style={styles.stateBody}>
                Payment was returned by the gateway. We're waiting for verified server confirmation before unlocking content.
              </Text>
            </View>
          )}

          {step === "PENDING" && (
            <View style={styles.centered}>
              <View style={styles.pendingIcon}>
                <Clock3 color="#F59E0B" size={34} />
              </View>
              <Text style={styles.stateTitle}>Still confirming</Text>
              <Text style={styles.stateBody}>
                We haven't received final payment confirmation yet. Your content remains locked until verification completes.
              </Text>
              {errorMessage ? <Text style={styles.inlineError}>{errorMessage}</Text> : null}
              <Pressable style={styles.secondaryButton} onPress={checkAgain}>
                <Text style={styles.secondaryButtonText}>Check again</Text>
              </Pressable>
              <Pressable style={styles.textButton} onPress={close}>
                <Text style={styles.textButtonText}>Close and check later</Text>
              </Pressable>
            </View>
          )}

          {step === "FAILED" && (
            <View style={styles.centered}>
              <View style={styles.failedIcon}>
                <AlertTriangle color="#EF4444" size={34} />
              </View>
              <Text style={styles.stateTitle}>Payment not completed</Text>
              <Text style={styles.stateBody}>
                {failureReason || "The payment failed. No subscription access was activated."}
              </Text>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => {
                  setFailureReason(null);
                  setErrorMessage(null);
                  setStep("OFFER");
                }}
              >
                <Text style={styles.secondaryButtonText}>Try again</Text>
              </Pressable>
            </View>
          )}

          {step === "SUCCESS" && (
            <View style={styles.centered}>
              <View style={styles.successIcon}>
                <BadgeCheck color="#fff" size={42} />
              </View>
              <Text style={styles.stateTitle}>Subscription active</Text>
              <Text style={styles.stateBody}>
                Your access to {artistName} is confirmed and subscriber content is now unlocked.
              </Text>
              {lastKnownExpiry ? (
                <Text style={styles.expiryText}>
                  Access until {new Date(lastKnownExpiry).toLocaleDateString()}
                </Text>
              ) : null}
              <Pressable style={styles.successButton} onPress={goToArtist}>
                <Text style={styles.successButtonText}>Explore unlocked content</Text>
              </Pressable>
            </View>
          )}
        </SafeAreaView>

        {step !== "SUCCESS" && step !== "PROCESSING" && (
          <Pressable
            style={[styles.closeButton, { top: insets.top + 8 }]}
            onPress={close}
            hitSlop={16}
          >
            <X color="#fff" size={22} />
          </Pressable>
        )}
      </View>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#080808" },
  safe: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 72, paddingBottom: 40 },
  closeButton: {
    position: "absolute",
    left: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.09)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: "#FF6A00",
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  eyebrow: {
    color: "#FF7A18",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.5,
    textAlign: "center",
  },
  title: {
    color: "#fff",
    fontSize: 30,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 8,
  },
  subtitle: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    marginTop: 10,
    marginBottom: 28,
  },
  card: {
    borderRadius: 24,
    padding: 20,
    backgroundColor: "rgba(255,255,255,0.055)",
    borderWidth: 1,
    borderColor: "rgba(255,122,24,0.25)",
  },
  priceRow: { flexDirection: "row", alignItems: "center" },
  cardTitle: { color: "#fff", fontSize: 18, fontWeight: "900" },
  cardSub: {
    color: "rgba(255,255,255,0.52)",
    fontSize: 12,
    marginTop: 5,
  },
  priceBlock: { alignItems: "flex-end", marginLeft: 12 },
  price: { color: "#fff", fontSize: 28, fontWeight: "900" },
  perMonth: { color: "rgba(255,255,255,0.45)", fontSize: 11 },
  divider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.09)",
    marginVertical: 18,
  },
  benefitRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(255,122,24,0.13)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  benefitText: { color: "rgba(255,255,255,0.78)", fontSize: 14, flex: 1 },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    marginTop: 16,
    borderRadius: 12,
    backgroundColor: "rgba(239,68,68,0.1)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.22)",
  },
  errorText: { color: "#FCA5A5", fontSize: 13, flex: 1, marginLeft: 9 },
  ctaWrap: { borderRadius: 16, overflow: "hidden", marginTop: 20 },
  cta: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  ctaText: { color: "#fff", fontSize: 16, fontWeight: "900" },
  disabled: { opacity: 0.45 },
  trustRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
    paddingHorizontal: 8,
  },
  trustText: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 11,
    marginLeft: 7,
    textAlign: "center",
    flexShrink: 1,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 30,
  },
  stateTitle: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 20,
  },
  stateBody: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    marginTop: 10,
    maxWidth: 420,
  },
  pendingIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(245,158,11,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  failedIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(239,68,68,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  successIcon: {
    width: 82,
    height: 82,
    borderRadius: 41,
    backgroundColor: "#10B981",
    alignItems: "center",
    justifyContent: "center",
  },
  inlineError: {
    color: "#FCA5A5",
    fontSize: 12,
    textAlign: "center",
    marginTop: 10,
  },
  secondaryButton: {
    backgroundColor: "#fff",
    borderRadius: 14,
    paddingHorizontal: 24,
    paddingVertical: 14,
    marginTop: 24,
  },
  secondaryButtonText: { color: "#111", fontSize: 15, fontWeight: "900" },
  textButton: { padding: 14, marginTop: 5 },
  textButtonText: { color: "rgba(255,255,255,0.55)", fontWeight: "700" },
  successButton: {
    backgroundColor: "#10B981",
    borderRadius: 14,
    paddingHorizontal: 24,
    paddingVertical: 14,
    marginTop: 24,
  },
  successButtonText: { color: "#fff", fontSize: 15, fontWeight: "900" },
  expiryText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    marginTop: 12,
  },
});
