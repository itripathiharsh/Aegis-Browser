import React, { useEffect, useRef, useState } from 'react';

interface StreamPlayerViewProps {
  url: string;
  onBackHome: () => void;
  onOpenStreamUrl: (url: string) => void;
}

export const StreamPlayerView: React.FC<StreamPlayerViewProps> = ({
  url,
  onBackHome,
  onOpenStreamUrl,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamUrl = (() => {
    const idx = url.indexOf('?src=');
    return idx >= 0
      ? decodeURIComponent(url.slice(idx + 5))
      : 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
  })();

  const [customStream, setCustomStream] = useState(streamUrl);
  const [statusMsg, setStatusMsg] = useState(
    'Hardware-accelerated HTML5 / HLS playback ready.'
  );

  useEffect(() => {
    setCustomStream(streamUrl);
  }, [streamUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video || document.activeElement?.tagName === 'INPUT') return;
      if (e.key === ' ' || e.key === 'MediaPlayPause') {
        e.preventDefault();
        if (video.paused) void video.play();
        else video.pause();
      } else if (e.key === 'f' || e.key === 'F') {
        void video.requestFullscreen?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <main className="main-stage" id="main">
      <div className="player-shell">
        <div className="section-head">
          <h1 className="section-title">Aegis Stream Player (HLS / MP4)</h1>
          <button type="button" className="secondary-btn" onClick={onBackHome}>
            Return to Start
          </button>
        </div>

        <video
          ref={videoRef}
          className="video-stage"
          src={streamUrl}
          controls
          autoPlay
          playsInline
          onCanPlay={() =>
            setStatusMsg('Stream loaded smoothly with hardware media decoding.')
          }
          onError={() =>
            setStatusMsg(
              'Note: Desktop browsers without native HLS require Android WebView or webOS Chromium to decode .m3u8 natively.'
            )
          }
        />

        <p className="stat-label">{statusMsg}</p>

        <form
          style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}
          onSubmit={(e) => {
            e.preventDefault();
            if (customStream.trim()) onOpenStreamUrl(customStream.trim());
          }}
        >
          <label htmlFor="stream-url-input" className="sr-only">
            Stream URL
          </label>
          <input
            id="stream-url-input"
            className="text-input"
            style={{ flex: '1 1 240px' }}
            value={customStream}
            onChange={(e) => setCustomStream(e.target.value)}
            placeholder="Paste .m3u8 or .mp4 stream URL"
          />
          <button type="submit" className="primary-btn">
            Load Stream
          </button>
        </form>
      </div>
    </main>
  );
};
