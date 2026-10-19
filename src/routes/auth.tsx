import { createFileRoute, useNavigate, Link, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PhoneShell } from "@/components/PhoneShell";
import { useLang } from "@/lib/i18n";
import { Mail, Lock, User as UserIcon, ArrowLeft, Phone, KeyRound, RotateCcw } from "lucide-react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

export const Route = createFileRoute("/auth")({
  ssr: false,
  beforeLoad: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        throw redirect({ to: "/home" });
      }
    } catch (e: any) {
      if (e?.to) throw e;
    }
  },
  head: () => ({
    meta: [
      { title: "Sign in — MirchiRakshak" },
      { name: "description", content: "Sign in or create an account to protect your chili crop." },
    ],
  }),
  component: AuthPage,
});

function formatPhone(num: string) {
  let digits = num.replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length === 12) {
    digits = digits.slice(2);
  } else if (digits.startsWith("0") && digits.length === 11) {
    digits = digits.slice(1);
  }
  if (!/^[6-9]\d{9}$/.test(digits)) {
    throw new Error("Enter a valid 10-digit Indian mobile number (e.g. 9876543210).");
  }
  return `+91${digits}`;
}

function AuthPage() {
  const { t } = useLang();
  const nav = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [signInType, setSignInType] = useState<"phone" | "email">("phone");
  const [phoneStep, setPhoneStep] = useState<"enter_phone" | "enter_otp">("enter_phone");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (countdown <= 0) return;
    const interval = setInterval(() => {
      setCountdown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [countdown]);

  async function google() {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/home`,
        },
      });
      if (error) throw error;
    } catch (e: any) {
      console.error("Google auth error:", e);
      toast.error(e?.message || "Google sign-in failed. Please use Phone number.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSendOtp(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!phone.trim()) {
      toast.error("Please enter your 10-digit mobile number");
      return;
    }
    let formattedPhone: string;
    try {
      formattedPhone = formatPhone(phone);
    } catch (err: any) {
      toast.error(err.message || "Enter a valid 10-digit Indian mobile number");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone: formattedPhone,
        options: {
          data: {
            full_name: name.trim() || undefined,
          },
        },
      });

      if (error) {
        if (/Phone logins are disabled|Phone signups are disabled|unsupported phone provider/i.test(error.message)) {
          toast.error("Phone Auth is disabled in Supabase. Enable Phone provider in Supabase Dashboard (under Authentication > Providers > Phone).", {
            duration: 6000,
          });
          return;
        }
        throw error;
      }

      toast.success(`OTP sent to ${formattedPhone}`);
      setPhoneStep("enter_otp");
      setCountdown(30);
    } catch (e: any) {
      console.error("Send OTP error:", e);
      toast.error(e?.message || "Failed to send SMS OTP.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (otp.length < 6) {
      toast.error("Please enter the 6-digit OTP code");
      return;
    }
    let formattedPhone: string;
    try {
      formattedPhone = formatPhone(phone);
    } catch (err: any) {
      toast.error(err.message);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        phone: formattedPhone,
        token: otp.trim(),
        type: "sms",
      });

      if (error) {
        if (/token has expired|invalid token/i.test(error.message)) {
          toast.error("Invalid or expired OTP. Please try again or tap Resend.");
          return;
        }
        throw error;
      }

      if (data?.user) {
        try {
          await supabase.from("profiles").upsert({
            id: data.user.id,
            full_name: name.trim() || data.user.user_metadata?.full_name || "Farmer",
            phone: formattedPhone,
            district: "Guntur",
            language: "en",
          });
        } catch (profileErr) {
          console.warn("Profile sync error:", profileErr);
        }

        toast.success("Verified successfully! Welcome to Mirchi Rakshak.");
        nav({ to: "/home" });
      }
    } catch (e: any) {
      console.error("Verify OTP error:", e);
      toast.error(e?.message || "OTP verification failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: {
              full_name: name.trim() || undefined,
            },
          },
        });

        if (error) throw error;

        if (data?.user) {
          try {
            await supabase.from("profiles").upsert({
              id: data.user.id,
              full_name: name.trim() || cleanEmail.split("@")[0],
              district: "Guntur",
              language: "en",
            });
          } catch (profileErr) {
            console.warn("Profile sync note:", profileErr);
          }
        }

        if (data?.session) {
          toast.success("Account created successfully!");
          nav({ to: "/home" });
        } else {
          toast.success("Account created! You can now sign in.");
          setMode("signin");
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });

        if (error) {
          if (/invalid login credentials/i.test(error.message)) {
            toast.error("Incorrect email or password. Please try again.");
            return;
          }
          throw error;
        }

        if (data?.user) {
          toast.success("Signed in successfully!");
          nav({ to: "/home" });
        }
      }
    } catch (e: any) {
      console.error("Email auth error:", e);
      toast.error(e?.message || "Authentication failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <PhoneShell>
      <div className="min-h-screen flex flex-col px-6 pt-14 pb-8">
        {phoneStep === "enter_otp" ? (
          <button
            type="button"
            onClick={() => setPhoneStep("enter_phone")}
            className="size-10 rounded-full bg-white ring-1 ring-black/5 grid place-items-center shadow-sm mb-6"
            aria-label="Back"
          >
            <ArrowLeft className="size-4" />
          </button>
        ) : (
          <Link
            to="/onboarding"
            className="size-10 rounded-full bg-white ring-1 ring-black/5 grid place-items-center shadow-sm mb-6"
            aria-label="Back"
          >
            <ArrowLeft className="size-4" />
          </Link>
        )}

        {/* Step 2: Enter OTP Screen */}
        {signInType === "phone" && phoneStep === "enter_otp" ? (
          <div className="my-auto">
            <div className="size-14 rounded-2xl bg-chili-50 ring-1 ring-chili-200/50 flex items-center justify-center text-chili-600 mb-6 mx-auto">
              <KeyRound className="size-7" />
            </div>

            <div className="text-center mb-8">
              <h1 className="text-2xl font-bold tracking-tight text-stone-900">
                Verify Mobile Number
              </h1>
              <p className="mt-2 text-stone-500 text-sm">
                Enter the 6-digit code sent via SMS to{" "}
                <span className="font-semibold text-stone-800">+91 {phone}</span>
              </p>
              <button
                type="button"
                onClick={() => setPhoneStep("enter_phone")}
                className="mt-1 text-xs text-chili-600 font-semibold hover:underline"
              >
                Change mobile number
              </button>
            </div>

            <form onSubmit={handleVerifyOtp} className="space-y-6">
              <div className="flex justify-center">
                <InputOTP maxLength={6} value={otp} onChange={(val) => setOtp(val)}>
                  <InputOTPGroup className="gap-2">
                    <InputOTPSlot index={0} className="size-12 text-lg font-bold rounded-xl ring-1 ring-black/10 bg-white" />
                    <InputOTPSlot index={1} className="size-12 text-lg font-bold rounded-xl ring-1 ring-black/10 bg-white" />
                    <InputOTPSlot index={2} className="size-12 text-lg font-bold rounded-xl ring-1 ring-black/10 bg-white" />
                    <InputOTPSlot index={3} className="size-12 text-lg font-bold rounded-xl ring-1 ring-black/10 bg-white" />
                    <InputOTPSlot index={4} className="size-12 text-lg font-bold rounded-xl ring-1 ring-black/10 bg-white" />
                    <InputOTPSlot index={5} className="size-12 text-lg font-bold rounded-xl ring-1 ring-black/10 bg-white" />
                  </InputOTPGroup>
                </InputOTP>
              </div>

              <button
                type="submit"
                disabled={loading || otp.length < 6}
                className="w-full bg-chili-600 text-white rounded-2xl py-4 font-semibold shadow-lg shadow-chili-600/30 active:scale-[0.98] transition disabled:opacity-50"
              >
                {loading ? "Verifying…" : "Verify & Sign In"}
              </button>
            </form>

            <div className="mt-6 text-center">
              {countdown > 0 ? (
                <p className="text-xs text-stone-400">
                  Resend OTP in <span className="font-semibold text-stone-600">{countdown}s</span>
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => handleSendOtp()}
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 text-xs text-chili-600 font-semibold hover:underline"
                >
                  <RotateCcw className="size-3.5" /> Resend OTP
                </button>
              )}
            </div>
          </div>
        ) : (
          /* Step 1: Phone or Email Entry Screen */
          <>
            <div className="mb-6">
              <p className="text-chili-600 font-telugu font-medium text-sm mb-1">{t("greeting")} 🙏</p>
              <h1 className="text-3xl font-bold tracking-tight text-stone-900">
                {mode === "signin" ? t("welcomeBack") : t("createAccount")}
              </h1>
              <p className="mt-1.5 text-stone-500 text-sm">
                {mode === "signin" ? t("signInSub") : t("signUpSub")}
              </p>
            </div>

            <button
              onClick={google}
              disabled={loading}
              className="w-full bg-white ring-1 ring-black/10 rounded-2xl py-3.5 flex items-center justify-center gap-3 font-semibold text-stone-800 shadow-sm active:scale-[0.98] transition disabled:opacity-60"
            >
              <svg viewBox="0 0 24 24" className="size-5">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.75h3.57c2.08-1.92 3.28-4.74 3.28-8.07z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.75c-.99.66-2.25 1.06-3.71 1.06-2.85 0-5.27-1.92-6.13-4.5H2.18v2.82C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.87 14.15A6.94 6.94 0 015.5 12c0-.75.13-1.48.36-2.15V7.03H2.18A11 11 0 001 12c0 1.77.42 3.45 1.18 4.97l3.69-2.82z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.03l3.69 2.82C6.73 7.3 9.15 5.38 12 5.38z"
                />
              </svg>
              {t("continueWithGoogle")}
            </button>

            <div className="my-5 flex items-center gap-3 text-stone-300 text-[10px] font-bold uppercase tracking-widest">
              <div className="flex-1 h-px bg-stone-200" /> {t("or")} {signInType === "phone" ? t("phone") : t("email")} <div className="flex-1 h-px bg-stone-200" />
            </div>

            <div className="grid grid-cols-2 p-1 bg-stone-100 rounded-2xl mb-4 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setSignInType("phone")}
                className={`py-2.5 rounded-xl transition flex items-center justify-center gap-2 ${
                  signInType === "phone"
                    ? "bg-white text-stone-900 shadow-sm"
                    : "text-stone-500 hover:text-stone-700"
                }`}
              >
                <Phone className="size-3.5" />
                Phone OTP
              </button>
              <button
                type="button"
                onClick={() => setSignInType("email")}
                className={`py-2.5 rounded-xl transition flex items-center justify-center gap-2 ${
                  signInType === "email"
                    ? "bg-white text-stone-900 shadow-sm"
                    : "text-stone-500 hover:text-stone-700"
                }`}
              >
                <Mail className="size-3.5" />
                {t("signInWithEmail")}
              </button>
            </div>

            {signInType === "phone" ? (
              <form onSubmit={handleSendOtp} className="space-y-3">
                {mode === "signup" && (
                  <div className="relative">
                    <UserIcon className="size-4 text-stone-400 absolute left-4 top-1/2 -translate-y-1/2" />
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      placeholder={t("fullName")}
                      className="w-full pl-11 pr-4 py-3.5 bg-white ring-1 ring-black/10 rounded-2xl text-sm placeholder:text-stone-400 focus:ring-2 focus:ring-chili-600 outline-none"
                    />
                  </div>
                )}

                <div className="relative flex items-center bg-white ring-1 ring-black/10 rounded-2xl overflow-hidden focus-within:ring-2 focus-within:ring-chili-600 transition">
                  <div className="flex items-center gap-1.5 pl-3.5 pr-2.5 py-3.5 border-r border-stone-200 bg-stone-50 select-none text-stone-700 font-semibold text-xs shrink-0">
                    <span className="text-base leading-none">🇮🇳</span>
                    <span>+91</span>
                  </div>
                  <input
                    value={phone}
                    onChange={(e) => {
                      let val = e.target.value.replace(/\D/g, "");
                      if (val.startsWith("91") && val.length > 10) val = val.slice(2);
                      else if (val.startsWith("0") && val.length > 10) val = val.slice(1);
                      setPhone(val.slice(0, 10));
                    }}
                    required
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    maxLength={10}
                    placeholder={t("phonePlaceholder") || "98765 43210"}
                    className="w-full px-3.5 py-3.5 bg-transparent text-sm placeholder:text-stone-400 outline-none font-medium tracking-wide text-stone-900"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || phone.length < 10}
                  className="w-full bg-chili-600 text-white rounded-2xl py-4 font-semibold shadow-lg shadow-chili-600/30 active:scale-[0.98] transition disabled:opacity-60"
                >
                  {loading ? "Sending OTP…" : "Send OTP"}
                </button>
              </form>
            ) : (
              <form onSubmit={handleEmailSubmit} className="space-y-3">
                {mode === "signup" && (
                  <div className="relative">
                    <UserIcon className="size-4 text-stone-400 absolute left-4 top-1/2 -translate-y-1/2" />
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      placeholder={t("fullName")}
                      className="w-full pl-11 pr-4 py-3.5 bg-white ring-1 ring-black/10 rounded-2xl text-sm placeholder:text-stone-400 focus:ring-2 focus:ring-chili-600 outline-none"
                    />
                  </div>
                )}

                <div className="relative">
                  <Mail className="size-4 text-stone-400 absolute left-4 top-1/2 -translate-y-1/2" />
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    type="email"
                    autoComplete="email"
                    placeholder={t("email")}
                    className="w-full pl-11 pr-4 py-3.5 bg-white ring-1 ring-black/10 rounded-2xl text-sm placeholder:text-stone-400 focus:ring-2 focus:ring-chili-600 outline-none"
                  />
                </div>

                <div className="relative">
                  <Lock className="size-4 text-stone-400 absolute left-4 top-1/2 -translate-y-1/2" />
                  <input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    type="password"
                    minLength={6}
                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    placeholder={t("password")}
                    className="w-full pl-11 pr-4 py-3.5 bg-white ring-1 ring-black/10 rounded-2xl text-sm placeholder:text-stone-400 focus:ring-2 focus:ring-chili-600 outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-chili-600 text-white rounded-2xl py-4 font-semibold shadow-lg shadow-chili-600/30 active:scale-[0.98] transition disabled:opacity-60"
                >
                  {loading ? "…" : mode === "signin" ? t("signIn") : t("signUp")}
                </button>
              </form>
            )}

            <button
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
              }}
              className="mt-auto pt-8 text-center text-sm text-stone-500"
            >
              {mode === "signin" ? (
                <>
                  {t("newHere")}{" "}
                  <span className="font-semibold text-chili-600">{t("signUp")}</span>
                </>
              ) : (
                <>
                  {t("alreadyAccount")}{" "}
                  <span className="font-semibold text-chili-600">{t("signIn")}</span>
                </>
              )}
            </button>
          </>
        )}
      </div>
    </PhoneShell>
  );
}
