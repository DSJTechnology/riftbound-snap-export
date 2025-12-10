import { useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CameraPreviewProps {
  onCapture?: (imageData: string) => void;
}

export function CameraPreview({ onCapture }: CameraPreviewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openCamera = async () => {
    setError(null);

    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      setError("Camera not supported in this browser.");
      return;
    }

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });

      setStream(mediaStream);

      const video = videoRef.current;
      if (video) {
        video.srcObject = mediaStream;
        await video.play();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error opening camera";
      setError(msg);
      console.error("getUserMedia error:", e);
    }
  };

  const closeCamera = () => {
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const captureFrame = () => {
    if (!videoRef.current || !onCapture) return;
    
    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(video, 0, 0);
      onCapture(canvas.toDataURL("image/jpeg"));
    }
  };

  return (
    <div className="flex flex-col gap-4 items-center w-full">
      {/* Camera Preview Area */}
      <div className="w-full aspect-video border-2 border-dashed border-border rounded-xl flex items-center justify-center bg-black overflow-hidden relative">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
          style={{ display: stream ? "block" : "none" }}
        />
        
        {/* Card placement guide overlay */}
        {stream && (
          <div className="absolute inset-4 border-2 border-primary/50 rounded-lg pointer-events-none">
            <div className="absolute top-2 left-2 w-6 h-6 border-t-2 border-l-2 border-primary rounded-tl-md" />
            <div className="absolute top-2 right-2 w-6 h-6 border-t-2 border-r-2 border-primary rounded-tr-md" />
            <div className="absolute bottom-2 left-2 w-6 h-6 border-b-2 border-l-2 border-primary rounded-bl-md" />
            <div className="absolute bottom-2 right-2 w-6 h-6 border-b-2 border-r-2 border-primary rounded-br-md" />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-primary/70 text-sm bg-black/50 px-2 py-1 rounded">
                Position card here
              </span>
            </div>
          </div>
        )}
        
        {/* Placeholder when camera is off */}
        {!stream && (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Camera className="w-12 h-12 opacity-50" />
            <span className="text-sm">Camera preview will appear here</span>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex gap-3">
        {!stream ? (
          <Button onClick={openCamera} className="gap-2">
            <Camera className="w-4 h-4" />
            Open Camera
          </Button>
        ) : (
          <>
            {onCapture && (
              <Button onClick={captureFrame} variant="default">
                Capture
              </Button>
            )}
            <Button onClick={closeCamera} variant="outline" className="gap-2">
              <X className="w-4 h-4" />
              Close Camera
            </Button>
          </>
        )}
      </div>

      {/* Error message */}
      {error && (
        <p className="text-destructive text-sm text-center">{error}</p>
      )}
    </div>
  );
}
