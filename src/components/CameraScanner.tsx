import { useRef, useState, useCallback, useEffect } from 'react';
import { createWorker, Worker } from 'tesseract.js';
import { Camera, X, Loader2, ScanLine, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CardData, findCardById, CARD_ID_PATTERN } from '@/data/cardDatabase';
import { cn } from '@/lib/utils';

interface CameraScannerProps {
  onCardDetected: (card: CardData, detectedId: string) => void;
  onManualSearch: () => void;
}

export function CameraScanner({ onCardDetected, onManualSearch }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [worker, setWorker] = useState<Worker | null>(null);
  const [lastDetectedId, setLastDetectedId] = useState<string | null>(null);

  // Initialize Tesseract worker
  useEffect(() => {
    let mounted = true;
    
    const initWorker = async () => {
      try {
        const tesseractWorker = await createWorker('eng');
        if (mounted) {
          setWorker(tesseractWorker);
        }
      } catch (err) {
        console.error('Failed to initialize OCR:', err);
      }
    };

    initWorker();

    return () => {
      mounted = false;
    };
  }, []);

  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      if (worker) {
        worker.terminate();
      }
    };
  }, [worker]);

  const startCamera = useCallback(async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment', // Use back camera on mobile
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setIsStreaming(true);
      }
    } catch (err) {
      console.error('Camera access error:', err);
      if (err instanceof Error) {
        if (err.name === 'NotAllowedError') {
          setError('Camera access denied. Please allow camera access and try again, or use manual search.');
        } else if (err.name === 'NotFoundError') {
          setError('No camera found. Please use manual search to add cards.');
        } else {
          setError('Unable to access camera. Please use manual search.');
        }
      }
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsStreaming(false);
    setLastDetectedId(null);
  }, []);

  const captureAndScan = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || !worker) return;

    setIsScanning(true);
    setLastDetectedId(null);

    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');

      if (!ctx) return;

      // Set canvas size to match video
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      // Draw the current video frame
      ctx.drawImage(video, 0, 0);

      // Focus on the bottom third of the image (where card ID usually is)
      const cropY = Math.floor(canvas.height * 0.6);
      const cropHeight = Math.floor(canvas.height * 0.35);
      
      // Create a cropped canvas for OCR
      const croppedCanvas = document.createElement('canvas');
      croppedCanvas.width = canvas.width;
      croppedCanvas.height = cropHeight;
      const croppedCtx = croppedCanvas.getContext('2d');
      
      if (croppedCtx) {
        croppedCtx.drawImage(canvas, 0, cropY, canvas.width, cropHeight, 0, 0, canvas.width, cropHeight);
        
        // Apply some preprocessing for better OCR
        const imageData = croppedCtx.getImageData(0, 0, croppedCanvas.width, croppedCanvas.height);
        const data = imageData.data;
        
        // Convert to grayscale and increase contrast
        for (let i = 0; i < data.length; i += 4) {
          const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
          const contrast = avg > 128 ? 255 : 0; // High contrast threshold
          data[i] = contrast;
          data[i + 1] = contrast;
          data[i + 2] = contrast;
        }
        croppedCtx.putImageData(imageData, 0, 0);
      }

      // Run OCR on the cropped area
      const { data: { text } } = await worker.recognize(croppedCanvas);
      
      // Find card ID patterns in the text
      const matches = text.match(CARD_ID_PATTERN);
      
      if (matches && matches.length > 0) {
        // Try to find a matching card
        for (const match of matches) {
          const cardId = match.toUpperCase();
          const card = findCardById(cardId);
          
          if (card) {
            setLastDetectedId(cardId);
            onCardDetected(card, cardId);
            return;
          }
        }
        // Found pattern but no matching card
        setLastDetectedId(matches[0].toUpperCase());
        setError(`Detected "${matches[0].toUpperCase()}" but no matching card found. Try manual search.`);
      } else {
        setError('No card ID detected. Try repositioning the card or use manual search.');
      }
    } catch (err) {
      console.error('Scan error:', err);
      setError('Scan failed. Please try again or use manual search.');
    } finally {
      setIsScanning(false);
    }
  }, [worker, onCardDetected]);

  return (
    <div className="space-y-4">
      {!isStreaming ? (
        <div className="space-y-4">
          <Button
            variant="scanner"
            size="xl"
            className="w-full"
            onClick={startCamera}
            disabled={!worker}
          >
            {!worker ? (
              <>
                <Loader2 className="animate-spin" />
                Loading OCR...
              </>
            ) : (
              <>
                <Camera className="w-5 h-5" />
                Open Camera
              </>
            )}
          </Button>

          {error && (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-sm">
              <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="text-destructive">{error}</p>
                <Button
                  variant="link"
                  size="sm"
                  className="px-0 h-auto mt-1 text-primary"
                  onClick={onManualSearch}
                >
                  Use Manual Search →
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Camera Preview */}
          <div className="relative rounded-lg overflow-hidden bg-muted aspect-[4/3]">
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              playsInline
              muted
            />
            
            {/* Scan overlay */}
            <div className="absolute inset-0 pointer-events-none">
              {/* Target area indicator */}
              <div className="absolute bottom-[15%] left-[10%] right-[10%] h-[25%] border-2 border-primary/60 rounded-lg">
                {isScanning && (
                  <div className="absolute inset-0 overflow-hidden">
                    <div className="absolute left-0 right-0 h-0.5 bg-primary scanner-line" />
                  </div>
                )}
              </div>
              
              {/* Corner markers */}
              <div className="absolute bottom-[15%] left-[10%] w-4 h-4 border-l-2 border-t-2 border-primary" />
              <div className="absolute bottom-[15%] right-[10%] w-4 h-4 border-r-2 border-t-2 border-primary" />
              <div className="absolute bottom-[40%] left-[10%] w-4 h-4 border-l-2 border-b-2 border-primary" />
              <div className="absolute bottom-[40%] right-[10%] w-4 h-4 border-r-2 border-b-2 border-primary" />
              
              {/* Instruction text */}
              <div className="absolute bottom-2 left-0 right-0 text-center">
                <span className="text-xs bg-background/80 px-2 py-1 rounded text-muted-foreground">
                  Position card ID in the highlighted area
                </span>
              </div>
            </div>

            {/* Hidden canvas for capture */}
            <canvas ref={canvasRef} className="hidden" />
          </div>

          {/* Control buttons */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              size="lg"
              onClick={stopCamera}
              className="flex-1"
            >
              <X className="w-4 h-4" />
              Close
            </Button>
            <Button
              variant="scanner"
              size="lg"
              onClick={captureAndScan}
              disabled={isScanning}
              className="flex-[2]"
            >
              {isScanning ? (
                <>
                  <Loader2 className="animate-spin" />
                  Scanning...
                </>
              ) : (
                <>
                  <ScanLine className="w-5 h-5" />
                  Capture & Scan
                </>
              )}
            </Button>
          </div>

          {/* Last detected ID */}
          {lastDetectedId && (
            <p className="text-center text-sm text-muted-foreground">
              Detected: <span className="font-mono text-foreground">{lastDetectedId}</span>
            </p>
          )}

          {/* Error message */}
          {error && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm">
              <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-destructive text-xs">{error}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
