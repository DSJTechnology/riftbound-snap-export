import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { createWorker, Worker } from 'tesseract.js';
import { Camera, X, Loader2, ScanLine, AlertCircle, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CardData, CARD_ID_PATTERN } from '@/data/cardDatabase';
import { useCardDatabase, createCardDatabaseHelpers } from '@/contexts/CardDatabaseContext';
import { cn } from '@/lib/utils';

interface CardScannerProps {
  onCardDetected: (card: CardData) => void;
  onScanFailed: () => void;
}

export function CardScanner({ onCardDetected, onScanFailed }: CardScannerProps) {
  const { cards } = useCardDatabase();
  const cardHelpers = useMemo(() => createCardDatabaseHelpers(cards), [cards]);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  const [isStreaming, setIsStreaming] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isWorkerReady, setIsWorkerReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastDetectedId, setLastDetectedId] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);

  // Initialize Tesseract worker on mount
  useEffect(() => {
    let mounted = true;
    
    const initWorker = async () => {
      try {
        const tesseractWorker = await createWorker('eng');
        if (mounted) {
          workerRef.current = tesseractWorker;
          setIsWorkerReady(true);
        }
      } catch (err) {
        console.error('Failed to initialize OCR:', err);
        if (mounted) {
          setError('OCR initialization failed. Please refresh the page.');
        }
      }
    };

    initWorker();

    return () => {
      mounted = false;
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const openCamera = useCallback(async () => {
    try {
      setError(null);
      setIsVideoReady(false);
      setLastDetectedId(null);

      // Request camera with portrait-friendly constraints
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          // Request portrait dimensions (width < height)
          width: { ideal: 720 },
          height: { ideal: 1280 },
        },
        audio: false,
      });

      streamRef.current = mediaStream;
      setIsStreaming(true);

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        // Explicit play for mobile browsers
        await videoRef.current.play();
      }
    } catch (err) {
      console.error('Camera access error:', err);
      if (err instanceof Error) {
        if (err.name === 'NotAllowedError') {
          setError('Camera access denied. Please allow camera access in your browser settings.');
        } else if (err.name === 'NotFoundError') {
          setError('No camera found on this device.');
        } else {
          setError(`Camera error: ${err.message}`);
        }
      } else {
        setError('Failed to open camera.');
      }
    }
  }, []);

  const closeCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsStreaming(false);
    setIsVideoReady(false);
    setLastDetectedId(null);
    setError(null);
  }, []);

  const handleVideoReady = useCallback(() => {
    if (videoRef.current && videoRef.current.readyState >= 2) {
      setIsVideoReady(true);
    }
  }, []);

  const handleVideoError = useCallback(() => {
    setError('Video playback error. Please try again.');
    setIsVideoReady(false);
  }, []);

  const captureAndScan = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || !workerRef.current) {
      setError('Scanner not ready. Please wait.');
      return;
    }

    setIsScanning(true);
    setLastDetectedId(null);
    setError(null);

    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        throw new Error('Canvas context not available');
      }

      // Set canvas to video dimensions
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      // Draw the current video frame
      ctx.drawImage(video, 0, 0);

      // Crop the lower portion where card ID is expected (bottom 25-30%)
      const cropY = Math.floor(canvas.height * 0.65);
      const cropHeight = Math.floor(canvas.height * 0.30);
      
      // Create a cropped canvas for OCR
      const croppedCanvas = document.createElement('canvas');
      croppedCanvas.width = canvas.width;
      croppedCanvas.height = cropHeight;
      const croppedCtx = croppedCanvas.getContext('2d');
      
      if (!croppedCtx) {
        throw new Error('Cropped canvas context not available');
      }

      // Copy the cropped region
      croppedCtx.drawImage(
        canvas, 
        0, cropY, canvas.width, cropHeight, 
        0, 0, canvas.width, cropHeight
      );
      
      // Apply preprocessing for better OCR
      const imageData = croppedCtx.getImageData(0, 0, croppedCanvas.width, croppedCanvas.height);
      const data = imageData.data;
      
      // Convert to high-contrast grayscale
      for (let i = 0; i < data.length; i += 4) {
        const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const contrast = avg > 128 ? 255 : 0;
        data[i] = contrast;
        data[i + 1] = contrast;
        data[i + 2] = contrast;
      }
      croppedCtx.putImageData(imageData, 0, 0);

      // Run OCR on the cropped area
      const { data: { text } } = await workerRef.current.recognize(croppedCanvas);
      
      // Find card ID patterns in the text
      const matches = text.match(CARD_ID_PATTERN);
      
      if (matches && matches.length > 0) {
        // Try to find a matching card in our database
        for (const match of matches) {
          const cardId = match.toUpperCase();
          const card = cardHelpers.findCardById(cardId);
          
          if (card) {
            setLastDetectedId(cardId);
            onCardDetected(card);
            return;
          }
        }
        
        // Found pattern but no matching card in database
        setLastDetectedId(matches[0].toUpperCase());
        setError(`Detected "${matches[0].toUpperCase()}" but card not in database. Try manual search.`);
        onScanFailed();
      } else {
        setError("Couldn't read card ID. Please reposition and try again, or search manually.");
        onScanFailed();
      }
    } catch (err) {
      console.error('Scan error:', err);
      setError('Scan failed. Please try again or use manual search.');
      onScanFailed();
    } finally {
      setIsScanning(false);
    }
  }, [onCardDetected, onScanFailed, cardHelpers]);

  return (
    <div className="space-y-4">
      {/* Camera Preview Area - Always visible */}
      <div 
        className={cn(
          "relative w-full overflow-hidden rounded-xl border-2",
          isStreaming ? "border-primary/50" : "border-dashed border-border",
          "bg-black"
        )}
        style={{ aspectRatio: '3/4' }}
      >
        {/* Video element */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          onLoadedMetadata={handleVideoReady}
          onLoadedData={handleVideoReady}
          onCanPlay={handleVideoReady}
          onPlay={handleVideoReady}
          onError={handleVideoError}
          className={cn(
            "absolute inset-0 w-full h-full object-cover",
            !isStreaming && "hidden"
          )}
        />

        {/* Hidden canvas for OCR processing */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Placeholder when camera is off */}
        {!isStreaming && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <Camera className="w-16 h-16 opacity-30" />
            <span className="text-sm">Camera preview will appear here</span>
          </div>
        )}

        {/* Loading overlay while video initializes */}
        {isStreaming && !isVideoReady && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black z-10">
            <Loader2 className="w-10 h-10 animate-spin text-primary mb-2" />
            <span className="text-sm text-muted-foreground">Starting camera...</span>
          </div>
        )}

        {/* Scanning overlay - only show when video is ready */}
        {isStreaming && isVideoReady && (
          <div className="absolute inset-0 pointer-events-none">
            {/* Dark overlay outside scan area */}
            <div className="absolute inset-0 bg-black/40" />
            
            {/* Centered portrait card frame (2.5:3.5 aspect ratio) */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div 
                className="relative bg-transparent border-2 border-primary rounded-lg
                           shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]"
                style={{ aspectRatio: '2.5/3.5', height: '70%' }}
              >
                {/* Corner markers */}
                <div className="absolute -top-0.5 -left-0.5 w-6 h-6 border-t-3 border-l-3 border-primary rounded-tl-lg" />
                <div className="absolute -top-0.5 -right-0.5 w-6 h-6 border-t-3 border-r-3 border-primary rounded-tr-lg" />
                <div className="absolute -bottom-0.5 -left-0.5 w-6 h-6 border-b-3 border-l-3 border-primary rounded-bl-lg" />
                <div className="absolute -bottom-0.5 -right-0.5 w-6 h-6 border-b-3 border-r-3 border-primary rounded-br-lg" />
                
                {/* Scanning line animation */}
                {isScanning && (
                  <div className="absolute inset-0 overflow-hidden rounded-lg">
                    <div className="absolute left-0 right-0 h-1 bg-gradient-to-r from-transparent via-primary to-transparent animate-scan-line" />
                  </div>
                )}
                
                {/* Instruction text inside card frame */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-sm bg-background/90 px-3 py-1.5 rounded-full text-foreground font-medium">
                    Position card here
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Scanning overlay */}
        {isScanning && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-20">
            <div className="text-center">
              <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-3" />
              <span className="text-sm text-foreground font-medium">Reading card...</span>
            </div>
          </div>
        )}
      </div>

      {/* Control Buttons */}
      <div className="flex gap-3">
        {!isStreaming ? (
          <Button
            onClick={openCamera}
            disabled={!isWorkerReady}
            className="flex-1 h-14 text-base font-semibold"
            size="lg"
          >
            {!isWorkerReady ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                Loading OCR...
              </>
            ) : (
              <>
                <Camera className="w-5 h-5 mr-2" />
                Open Camera
              </>
            )}
          </Button>
        ) : (
          <>
            <Button
              onClick={closeCamera}
              variant="outline"
              className="flex-1 h-14"
              size="lg"
            >
              <X className="w-5 h-5 mr-2" />
              Close
            </Button>
            <Button
              onClick={captureAndScan}
              disabled={isScanning || !isVideoReady}
              className="flex-[2] h-14 text-base font-semibold"
              size="lg"
            >
              {isScanning ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  Scanning...
                </>
              ) : (
                <>
                  <ScanLine className="w-5 h-5 mr-2" />
                  Capture & Scan
                </>
              )}
            </Button>
          </>
        )}
      </div>

      {/* Last detected ID feedback */}
      {lastDetectedId && !error && (
        <p className="text-center text-sm text-muted-foreground">
          Detected: <span className="font-mono text-primary font-medium">{lastDetectedId}</span>
        </p>
      )}

      {/* Error message with manual search fallback */}
      {error && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/20">
          <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-destructive">{error}</p>
            <Button
              variant="link"
              size="sm"
              className="px-0 h-auto mt-2 text-primary"
              onClick={onScanFailed}
            >
              <Search className="w-4 h-4 mr-1" />
              Search Manually
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
