import React, { useEffect, useRef, useState } from "react";
import { authToken } from "../../lib/api";

type InteractiveSurface = HTMLCanvasElement | HTMLImageElement;
type Props = {
  deviceId: string;
  fallbackUrl: string;
  alt: string;
  onPointerDown: React.PointerEventHandler<InteractiveSurface>;
  onPointerUp: React.PointerEventHandler<InteractiveSurface>;
  onPointerCancel?: React.PointerEventHandler<InteractiveSurface>;
  onStreamingChange?: (streaming: boolean) => void;
  onOrientationChange?: (orientation: "portrait" | "landscape") => void;
};

function splitAnnexB(buffer: Uint8Array): Uint8Array[] {
  const starts: number[] = [];
  for (let index = 0; index < buffer.length - 3; index++) {
    if (buffer[index] === 0 && buffer[index + 1] === 0 && (buffer[index + 2] === 1 || (buffer[index + 2] === 0 && buffer[index + 3] === 1))) starts.push(index);
  }
  return starts.map((start, index) => buffer.slice(start, starts[index + 1] ?? buffer.length)).filter((unit) => unit.length > 4);
}

export function MobileStream({ deviceId, fallbackUrl, alt, onPointerDown, onPointerUp, onPointerCancel, onStreamingChange, onOrientationChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [streaming, setStreaming] = useState(false);

  useEffect(() => {
    if (!("VideoDecoder" in window) || document.visibilityState === "hidden") return;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const tokenProtocol = authToken ? `quake-auth.${btoa(authToken).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}` : "quake-mobile-h264";
    const socket = new WebSocket(`${protocol}//${location.host}/api/mobile/stream?deviceId=${encodeURIComponent(deviceId)}&profile=balanced`, ["quake-mobile-h264", tokenProtocol]);
    socket.binaryType = "arraybuffer";
    let timestamp = 0;
    const decoder = new VideoDecoder({
      output(frame) {
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = frame.displayWidth;
          canvas.height = frame.displayHeight;
          onOrientationChange?.(frame.displayWidth > frame.displayHeight ? "landscape" : "portrait");
          canvas.getContext("2d")?.drawImage(frame, 0, 0);
          setStreaming(true);
          onStreamingChange?.(true);
        }
        frame.close();
      },
      error() { setStreaming(false); onStreamingChange?.(false); },
    });
    decoder.configure({ codec: "avc1.42E01E", optimizeForLatency: true });
    socket.onmessage = (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      for (const unit of splitAnnexB(new Uint8Array(event.data))) {
        const offset = unit[2] === 1 ? 3 : 4;
        const nalType = unit[offset]! & 0x1f;
        decoder.decode(new EncodedVideoChunk({ type: nalType === 5 ? "key" : "delta", timestamp: timestamp += 16_667, data: unit }));
      }
    };
    socket.onerror = () => { setStreaming(false); onStreamingChange?.(false); };
    socket.onclose = () => { setStreaming(false); onStreamingChange?.(false); };
    return () => { onStreamingChange?.(false); socket.close(); void decoder.flush().catch(() => undefined).finally(() => decoder.close()); };
  }, [deviceId, onOrientationChange, onStreamingChange]);

  return <>
    <canvas ref={canvasRef} aria-label={alt} hidden={!streaming} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} />
    {!streaming && fallbackUrl && <img src={fallbackUrl} alt={alt} draggable={false} onLoad={(event) => onOrientationChange?.(event.currentTarget.naturalWidth > event.currentTarget.naturalHeight ? "landscape" : "portrait")} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} />}
  </>;
}
