import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Image as ImageIcon, RotateCcw, CheckCircle2, AlertTriangle, SwitchCamera, Video, X } from "lucide-react";
import { PhoneShell } from "@/components/PhoneShell";
import { useLang } from "@/lib/i18n";
import { analyzeScan, saveScan } from "@/lib/ai.functions";
import { classifyChiliImageWithTFJS, loadChiliTFJSModel } from "@/lib/tfjsModel";
import type { ChiliScanImage } from "@/lib/tfjsModel";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { auth } from "@/lib/firebase";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { recordNewScan, type ScanRecord } from "@/lib/scans";

export const Route = createFileRoute("/_authenticated/scan")({
  head: () => ({ meta: [{ title: "Scan crop — MirchiRakshak AI" }] }),
  component: ScanPage,
});

type Awaited_<T> = T extends Promise<infer U> ? U : never;
type Result = Awaited_<ReturnType<typeof analyzeScan>>;

function ScanPage() {
  const { t, lang } = useLang();
  const nav = useNavigate();
  const analyze = useServerFn(analyzeScan);
  const save = useServerFn(saveScan);
  const qc = useQueryClient();

  const [preview, setPreview] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const [isCameraActive, setIsCameraActive] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [cameraLoading, setCameraLoading] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadChiliTFJSModel();
    return () => {
      stopCamera();
    };
  }, []);

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
    setCameraLoading(false);
  }

  async function startCamera(facing: "environment" | "user" = facingMode) {
    stopCamera();
    setCameraLoading(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Live camera is not supported in this browser. Please select or upload a photo.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => { });
      }
      setIsCameraActive(true);
    } catch (err) {
      console.error("Camera access error:", err);
      toast.error(err instanceof Error ? err.message : "Could not open camera. Please grant permission or choose a photo.");
      stopCamera();
    } finally {
      setCameraLoading(false);
    }
  }

  function toggleFacingMode() {
    const nextMode = facingMode === "environment" ? "user" : "environment";
    setFacingMode(nextMode);
    startCamera(nextMode);
  }

  function captureSnapshot() {
    const video = videoRef.current;
    if (!video || !isCameraActive) return;

    if (video.readyState < 2) {
      toast.error("Camera is warming up. Please hold steady and try again in a moment.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      toast.error("Could not capture image frame");
      return;
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", 0.92);

    stopCamera();
    setPreview(url);
    runAnalysis(url);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    stopCamera();
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      setPreview(url);
      runAnalysis(url);
    };
    reader.readAsDataURL(file);
  }

  async function runAnalysis(previewUrl: string) {
    setAnalyzing(true);
    setResult(null);
    try {
      const analysisImage = await prepareScanImage(previewUrl);
      const tfjsPromise = Promise.race([
        classifyChiliImageWithTFJS(analysisImage),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
      ]);
      const [imageStats, tfjsResult] = await Promise.all([
        getLeafImageStats(analysisImage),
        tfjsPromise,
      ]);

      const chlorophyllRatio = imageStats.greenRatio + imageStats.yellowRatio;
      const hasChiliVegetation = chlorophyllRatio >= 0.12 || (imageStats.greenRatio >= 0.08 && imageStats.yellowRatio >= 0.03);
      const hasChiliPod = (imageStats.redPodRatio ?? 0) >= 0.15;
      const isChiliSubject = (hasChiliVegetation || hasChiliPod) && (imageStats.skinRatio < 0.15 || chlorophyllRatio > imageStats.skinRatio * 1.5) && imageStats.nonPlantColorRatio < 0.10;

      // Only provide TFJS prediction if image subject is verified as genuine chili foliage or pod
      const predictedClass = isChiliSubject ? tfjsResult?.className : undefined;
      const compressedImage = analysisImage.toDataURL("image/jpeg", 0.78);
      const res = await analyze({
        data: {
          imageBase64: compressedImage.slice(compressedImage.indexOf(",") + 1),
          imageStats,
          predictedClass,
          language: lang,
        },
      });

      setResult(res);
      setAnalyzing(false);

      if (res.is_chili_leaf === false) {
        toast.error(t("leafNotMatched"), {
          description: res.invalid_reason || t("leafNotMatchedDesc"),
          duration: 5000,
        });
        return;
      }

      // Save valid chili scan locally immediately so it persists and updates the UI
      const newScanId = "scan-" + Date.now();
      const localScanData: ScanRecord = {
        id: newScanId,
        image_url: previewUrl,
        disease: res.disease || (res.is_healthy ? t("healthy") : "Chili Issue"),
        confidence: res.confidence,
        severity: res.severity,
        affected_area: res.affected_area,
        risk_level: res.risk_level,
        recommendation: res.recommendation,
        treatment: res.treatment,
        recovery_days: res.recovery_days,
        is_healthy: res.is_healthy,
        is_chili_leaf: res.is_chili_leaf,
        invalid_reason: res.invalid_reason,
        language: lang,
        created_at: new Date().toISOString(),
      };
      recordNewScan(localScanData);
      qc.invalidateQueries({ queryKey: ["scans"] });

      // Save valid chili scan to history asynchronously in background without blocking UI display
      (async () => {
        let currentUserId: string | null = null;
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user?.id) currentUserId = user.id;
        } catch { }

        if (!currentUserId && auth?.currentUser?.uid) {
          currentUserId = auth.currentUser.uid;
        }

        if (currentUserId) {
          try {
            const blob = await (await fetch(previewUrl)).blob();
            const path = `${currentUserId}/${Date.now()}.jpg`;
            const { error: upErr } = await supabase.storage.from("scans").upload(path, blob, { contentType: "image/jpeg" });
            if (!upErr) {
              const { data: signed } = await supabase.storage.from("scans").createSignedUrl(path, 60 * 60 * 24 * 365);
              if (signed?.signedUrl) {
                recordNewScan({ ...localScanData, image_url: signed.signedUrl });
                await save({ data: { ...res, image_url: signed.signedUrl, language: lang } as never });
              } else {
                await save({ data: { ...res, language: lang } as never });
              }
            } else {
              await save({ data: { ...res, language: lang } as never });
            }
            qc.invalidateQueries({ queryKey: ["scans"] });
          } catch (saveErr) {
            console.warn("Could not save scan upload to history:", saveErr);
            await save({ data: { ...res, language: lang } as never });
            qc.invalidateQueries({ queryKey: ["scans"] });
          }
        } else {
          await save({ data: { ...res, language: lang } as never });
          qc.invalidateQueries({ queryKey: ["scans"] });
        }
      })();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Analysis failed");
      setAnalyzing(false);
    }
  }

  function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
  }

  async function getLeafImageStats(image: ChiliScanImage): Promise<{
    greenRatio: number;
    foliageRatio: number;
    skinRatio: number;
    brownSpotRatio: number;
    yellowRatio: number;
    darkGreenRatio: number;
    glossyRatio: number;
    mottleRatio: number;
    nonPlantColorRatio: number;
    redPodRatio: number;
  }> {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 96;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return { greenRatio: 0, foliageRatio: 0, skinRatio: 0, brownSpotRatio: 0, yellowRatio: 0, darkGreenRatio: 0, glossyRatio: 0, mottleRatio: 0, nonPlantColorRatio: 0, redPodRatio: 0 };
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let skinPixels = 0;
    let healthyGreenPixels = 0;
    let chlorosisPixels = 0;
    let necroticBrownPixels = 0;
    let darkGlossyPixels = 0;
    let nonPlantColorPixels = 0;
    let redPodPixels = 0;

    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const [h, s, l] = rgbToHsl(red, green, blue);

      // 1. Human Skin Detection (Fitzpatrick scale I-VI, faces, selfies, hands, necks)
      // Warm hue (8-50 deg), red dominant over green and blue
      const isSkin =
        red >= 60 &&
        green >= 30 &&
        blue >= 15 &&
        red > green &&
        red > blue * 1.1 &&
        h >= 8 &&
        h <= 50 &&
        s >= 12 &&
        l >= 12 &&
        l <= 85;

      if (isSkin) {
        skinPixels++;
        continue;
      }

      // Red chili pod detection
      const isRedPod =
        (h >= 345 || h <= 20) &&
        s >= 45 &&
        l >= 20 &&
        l <= 75 &&
        red > 110 &&
        red > green * 1.5;

      if (isRedPod) {
        redPodPixels++;
        continue;
      }

      // Non-plant unnatural color detection (blue, cyan, purple, magenta hues: 175°-320°)
      if (h >= 175 && h <= 320 && s >= 18 && l >= 15 && l <= 90) {
        nonPlantColorPixels++;
      }

      // 2. Leaf Necrotic Brown / Black Spots (Anthracnose lesions, Leaf Spot, Pod Rot)
      // Dark necrotic tissue on leaf surface (low lightness, dark color)
      const isNecroticSpot =
        l >= 5 &&
        l <= 25 &&
        (red < 110 && green < 100 && blue < 80) &&
        Math.abs(red - green) < 25 &&
        s >= 5 &&
        s <= 55;

      if (isNecroticSpot) {
        necroticBrownPixels++;
        continue;
      }

      // 3. Chlorosis & Yellowing / Mosaic patches
      // Pale/bright yellowing: Hue 40° to 58°, high lightness L >= 40, S >= 25%
      const isChlorosis =
        h >= 40 &&
        h <= 58 &&
        s >= 25 &&
        l >= 40 &&
        l <= 90;

      // 4. Healthy Green Leaf (dominant chlorophyll)
      // Hue 59° to 155°, Green dominant or balanced with sunlight reflection
      const isHealthyGreen =
        !isChlorosis &&
        green >= 35 &&
        green >= red * 0.95 &&
        green > blue * 1.15 &&
        h >= 59 &&
        h <= 155 &&
        s >= 12 &&
        l >= 15 &&
        l <= 85;

      // Dark glossy green (signature of Mango/Banyan tree leaves)
      const isDarkGlossy = h >= 70 && h <= 150 && green < 95 && l < 30 && s >= 30;

      if (isChlorosis) chlorosisPixels++;
      else if (isHealthyGreen) healthyGreenPixels++;
      if (isDarkGlossy) darkGlossyPixels++;
    }

    const totalPixels = pixels.length / 4;
    const greenRatio = healthyGreenPixels / totalPixels;
    const yellowRatio = chlorosisPixels / totalPixels;
    const skinRatio = skinPixels / totalPixels;
    const rawNecroticRatio = necroticBrownPixels / totalPixels;
    const chlorophyllRatio = greenRatio + yellowRatio;
    // Necrotic spots are ONLY valid leaf lesions if surrounding leaf chlorophyll exists (>= 8%)
    const brownSpotRatio = chlorophyllRatio >= 0.08 ? Math.min(rawNecroticRatio, 0.25) : 0;
    const foliageRatio = chlorophyllRatio + brownSpotRatio;
    const mottleRatio = (yellowRatio >= 0.05 && greenRatio >= 0.10) ? Math.min(yellowRatio, greenRatio) * 2 : 0;
    const nonPlantColorRatio = nonPlantColorPixels / totalPixels;
    const redPodRatio = redPodPixels / totalPixels;

    return {
      greenRatio,
      foliageRatio,
      skinRatio,
      brownSpotRatio,
      yellowRatio,
      darkGreenRatio: darkGlossyPixels / totalPixels,
      glossyRatio: 0,
      mottleRatio,
      nonPlantColorRatio,
      redPodRatio,
    };
  }

  async function prepareScanImage(url: string): Promise<HTMLCanvasElement> {
    const image = new Image();
    image.src = url;
    await image.decode();

    const maxDimension = 640;
    const scale = Math.min(
      1,
      maxDimension / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Could not prepare the image for scanning");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function reset() {
    stopCamera();
    setPreview(null);
    setResult(null);
  }

  return (
    <PhoneShell>
      <div className="min-h-screen flex flex-col">
        <header className="px-5 pt-10 pb-4 flex items-center justify-between">
          <Link
            to="/home"
            onClick={stopCamera}
            className="size-10 rounded-full bg-white ring-1 ring-black/5 grid place-items-center shadow-sm"
            aria-label="Back"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <h1 className="text-base font-semibold text-stone-800">{t("scanCrop")}</h1>
          <div className="size-10" />
        </header>

        {!preview ? (
          <div className="flex-1 flex flex-col px-5 pb-8">
            <div className="flex-1 rounded-3xl bg-gradient-to-b from-stone-900 to-stone-800 grid place-items-center text-white relative overflow-hidden mb-5 aspect-[3/4]">
              {/* Video stream element */}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={cn(
                  "absolute inset-0 w-full h-full object-cover transition-opacity duration-300",
                  isCameraActive ? "opacity-100" : "opacity-0 pointer-events-none"
                )}
              />

              {/* Viewfinder reticle overlay */}
              <div className="absolute inset-6 rounded-2xl border-2 border-white/30 border-dashed pointer-events-none" />
              <div
                className="absolute inset-x-8 top-8 h-1 bg-gradient-to-r from-transparent via-chili-500 to-transparent shadow-[0_0_16px_rgba(249,115,22,0.8)] pointer-events-none"
                style={{ animation: "scan-line 2.4s ease-in-out infinite alternate" }}
              />

              {/* Camera loading state */}
              {cameraLoading && (
                <div className="absolute inset-0 bg-stone-900/90 grid place-items-center text-center z-10 p-6">
                  <div>
                    <div className="size-10 border-2 border-white/30 border-t-chili-500 rounded-full animate-spin mx-auto mb-3" />
                    <p className="text-sm font-semibold text-white">{t("openingCamera")}</p>
                  </div>
                </div>
              )}

              {/* Default placeholder info when camera is off */}
              {!isCameraActive && !cameraLoading && (
                <div className="relative text-center px-6 z-0">
                  <div className="text-5xl mb-3">🌶️</div>
                  <p className="font-semibold text-lg">{t("pointAtLeaf")}</p>
                  <p className="text-white/60 text-sm mt-1 max-w-[26ch] mx-auto">
                    {t("pointAtLeafSub")}
                  </p>
                </div>
              )}

              {/* Floating Camera Badges & Controls when active */}
              {isCameraActive && (
                <div className="absolute top-4 left-4 right-4 flex items-center justify-between z-10 pointer-events-auto">
                  <span className="bg-black/50 backdrop-blur-md px-3 py-1 rounded-full text-[11px] font-medium text-white flex items-center gap-1.5 border border-white/10">
                    <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                    {t("liveCamera")} ({facingMode === "environment" ? t("rear") : t("front")})
                  </span>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={toggleFacingMode}
                      className="size-9 rounded-full bg-black/50 backdrop-blur-md text-white grid place-items-center border border-white/10 active:scale-95 transition"
                      title="Flip camera"
                    >
                      <SwitchCamera className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={stopCamera}
                      className="size-9 rounded-full bg-black/50 backdrop-blur-md text-white grid place-items-center border border-white/10 active:scale-95 transition"
                      title="Close camera"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            {isCameraActive ? (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={captureSnapshot}
                  className="w-full bg-chili-600 hover:bg-chili-500 text-white rounded-2xl py-4 flex items-center justify-center gap-2 font-bold shadow-lg shadow-chili-600/30 active:scale-[0.98] transition"
                >
                  <div className="size-5 rounded-full border-2 border-white flex items-center justify-center">
                    <div className="size-2.5 rounded-full bg-white" />
                  </div>
                  <span>{t("takeSnapshotScan")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => galleryRef.current?.click()}
                  className="w-full bg-white ring-1 ring-black/10 hover:bg-stone-50 text-stone-800 rounded-2xl py-3 flex items-center justify-center gap-2 font-medium text-xs active:scale-[0.98] transition"
                >
                  <ImageIcon className="size-4 text-stone-500" />
                  <span>{t("galleryUpload")}</span>
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => startCamera("environment")}
                  className="w-full bg-chili-600 hover:bg-chili-500 text-white rounded-2xl py-4 flex items-center justify-center gap-2 font-bold shadow-lg shadow-chili-600/30 active:scale-[0.98] transition"
                >
                  <Video className="size-5" />
                  <span>{t("openLiveCamera")}</span>
                </button>

                <button
                  type="button"
                  onClick={() => galleryRef.current?.click()}
                  className="w-full bg-white hover:bg-stone-50 ring-1 ring-black/10 text-stone-800 rounded-2xl py-3.5 flex items-center justify-center gap-2.5 font-semibold text-sm shadow-xs active:scale-[0.98] transition"
                >
                  <ImageIcon className="size-5 text-stone-600" />
                  <span>{t("uploadPhoto")}</span>
                </button>
              </div>
            )}

            <input ref={galleryRef} type="file" accept="image/*" hidden onChange={onFile} />
          </div>
        ) : (
          <div className="flex-1 px-5 pb-8 space-y-4">
            <div className="relative rounded-3xl overflow-hidden ring-1 ring-black/5 aspect-square bg-stone-100">
              <img src={preview} alt="Scan preview" className="w-full h-full object-cover" />
              {analyzing && (
                <>
                  <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
                  <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-white to-transparent shadow-[0_0_20px_white]" style={{ animation: "scan-line 1.8s ease-in-out infinite alternate" }} />
                  <div className="absolute inset-0 grid place-items-center text-white">
                    <div className="text-center">
                      <div className="size-14 border-3 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-3" />
                      <p className="font-semibold">{t("analyzing")}</p>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button onClick={reset} className="bg-white ring-1 ring-black/5 text-stone-700 rounded-2xl py-3 font-semibold flex items-center justify-center gap-2">
                <RotateCcw className="size-4" /> {t("scanAgain")}
              </button>
              <button
                onClick={() => nav({ to: "/history" })}
                className="bg-stone-900 text-white rounded-2xl py-3 font-semibold"
              >
                {t("history")}
              </button>
            </div>

            {result && <ResultCard result={result} />}
          </div>
        )}
      </div>
    </PhoneShell>
  );
}

function ResultCard({ result }: { result: Result }) {
  const { t } = useLang();

  if (result.is_chili_leaf === false) {
    return (
      <div className="rounded-3xl p-5 bg-red-50 ring-1 ring-red-300/80 shadow-md animate-rise text-red-950 space-y-3 mt-3">
        <div className="flex items-center gap-2.5">
          <div className="size-8 rounded-full bg-red-600 grid place-items-center text-white shrink-0">
            <AlertTriangle className="size-4" />
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-red-700">
              {t("diagnosticError")}
            </span>
            <h2 className="text-base font-bold text-red-900 leading-tight">{result.disease || t("leafNotMatched")}</h2>
          </div>
        </div>

        <div className="bg-white/90 p-3.5 rounded-2xl border border-red-200 space-y-1">
          <p className="text-[11px] font-bold text-red-900 uppercase tracking-wider">{t("errorDescription")}:</p>
          <p className="text-xs text-red-800 leading-relaxed font-medium">
            {result.invalid_reason || t("leafNotMatchedDesc")}
          </p>
        </div>

        <div className="rounded-2xl bg-white p-3 text-xs text-red-900 border border-red-200/80 flex items-center gap-2 font-medium">
          <span className="text-lg">🌶️</span>
          <span>{t("scanAgainTip")}</span>
        </div>
      </div>
    );
  }

  const healthy = result.is_healthy;
  return (
    <div className={cn(
      "rounded-3xl p-5 ring-1 shadow-sm animate-rise",
      healthy ? "bg-leaf-50 ring-leaf-200" : "bg-white ring-black/5",
    )}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            {healthy ? <CheckCircle2 className="size-4 text-leaf-600" /> : <AlertTriangle className="size-4 text-chili-600" />}
            <span className={cn(
              "text-[10px] font-bold uppercase tracking-widest",
              healthy ? "text-leaf-700" : "text-chili-600",
            )}>
              {healthy ? t("healthy") : t("actionRequired")}
            </span>
          </div>
          <h2 className="text-xl font-bold text-stone-900">{result.disease}</h2>
          <p className="text-xs text-stone-500 mt-1">{result.affected_area}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <MetaChip label={t("severity")} value={result.severity} />
        <MetaChip label={t("recovery")} value={`${result.recovery_days} ${t("days")}`} />
      </div>

      <div className="mt-4 rounded-2xl bg-earth-50 p-4 ring-1 ring-black/5">
        <p className="text-[10px] font-bold text-stone-500 uppercase tracking-widest mb-2">{t("treatment")}</p>
        <p className="text-sm text-stone-700 leading-relaxed mb-3">{result.recommendation}</p>
        <ol className="space-y-2">
          {result.treatment.map((step, i) => (
            <li key={i} className="flex gap-3 text-sm text-stone-700">
              <span className="size-5 rounded-full bg-chili-600 text-white text-[11px] font-bold grid place-items-center shrink-0 mt-0.5">{i + 1}</span>
              <div>
                <p className="font-semibold">{step.step}</p>
                <p className="text-stone-500 text-xs">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-earth-50 rounded-xl p-3 ring-1 ring-black/5">
      <p className="text-[9px] font-bold text-stone-400 uppercase tracking-wider">{label}</p>
      <p className="text-sm font-semibold text-stone-800 mt-0.5">{value}</p>
    </div>
  );
}
