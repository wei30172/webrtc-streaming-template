"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { socketManager } from "@/lib/socket"
import { useWebRTC } from "@/hooks/useWebRTC"

export default function ViewerPage() {
  const [status, setStatus] = useState("Connecting...")
  const [hasJoinedRoom, setHasJoinedRoom] = useState(false)
  const [isJoining, setIsJoining] = useState(false)
  const [isProcessingOffer, setIsProcessingOffer] = useState(false)
  const [needsUserInteraction, setNeedsUserInteraction] = useState(false)
  const [isStreamPaused, setIsStreamPaused] = useState(false)
  const [isVideoPlaying, setIsVideoPlaying] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const retryCountRef = useRef(0)
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const router = useRouter()
  const params = useParams()
  const roomId = params.roomId as string
  const socket = socketManager.connect()

  const {
    isConnected: webrtcConnected,
    error,
    connectionState,
    remoteStream,
    setError,
    createAnswer,
    cleanup
  } = useWebRTC({
    socket,
    isStreamer: false
  })

  // Sleep helper
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

  // Wait until socket is connected (simple polling)
  const waitForSocketConnected = useCallback(
    async (timeoutMs = 5000) => {
      if (socket.connected) return

      const start = Date.now()
      while (!socket.connected && Date.now() - start < timeoutMs) {
        await sleep(100)
      }
    },
    [socket]
  )

  // Join the signaling room (Socket.IO)
  const joinRoom = useCallback(async () => {
    if (!roomId) {
      setError("Invalid room ID")
      return
    }

    // Prevent duplicate join attempts
    if (isJoining || hasJoinedRoom) return

    try {
      setIsJoining(true)
      setStatus("Joining signaling room...")
      setError(null)

      // Ensure socket is connected first
      await waitForSocketConnected(5000)

      socket.emit("join-room", roomId, (response: { success?: boolean; error?: string }) => {
        if (response?.error) {
          setError(response.error)
          setStatus("Failed to join signaling room")
          setIsJoining(false)
          return
        }

        setHasJoinedRoom(true)
        setStatus("Signaling connected — waiting for media stream...")
        setIsJoining(false)
        retryCountRef.current = 0
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Join room error")
      setStatus("Connection failed — retrying...")
      setIsJoining(false)
    }
  }, [roomId, socket, isJoining, hasJoinedRoom, setError, waitForSocketConnected])

  // Full reset for reconnect flow
  const handleReconnect = useCallback(async () => {
    // Clear any scheduled retry
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
      retryTimeoutRef.current = null
    }

    cleanup()
    retryCountRef.current = 0

    setHasJoinedRoom(false)
    setIsProcessingOffer(false)
    setNeedsUserInteraction(false)
    setIsStreamPaused(false)
    setIsVideoPlaying(false)

    setError(null)
    setStatus("Reconnecting signaling + WebRTC...")

    await joinRoom()
  }, [cleanup, joinRoom, setError])

  // Manual video playback (for autoplay policy)
  const playVideo = useCallback(async () => {
    if (!videoRef.current || !remoteStream) return

    try {
      await videoRef.current.play()
      setIsVideoPlaying(true)
      setNeedsUserInteraction(false)
      setIsStreamPaused(false)
      setStatus("Live stream")
    } catch (err) {
      setError("Unable to start playback: " + (err as Error).message)
    }
  }, [remoteStream, setError])

  // Leave room (just navigate; keep socket alive)
  const leaveRoom = useCallback(() => {
    router.push("/")
  }, [router])

  useEffect(() => {
    const shouldProcessOffer = () => {
      // Skip offers if connection already looks healthy
      if (webrtcConnected && connectionState === "connected") return false
      // Prevent concurrent offer processing
      if (isProcessingOffer) return false
      return true
    }

    const onReconnect = () => {
      void handleReconnect()
    }

    const onOffer = ({ offer, sender }: { offer: RTCSessionDescriptionInit; sender: string }) => {
      if (!shouldProcessOffer()) return

      setIsProcessingOffer(true)
      setStatus("Negotiating WebRTC session...")

      createAnswer(offer, sender)
        .catch(err => setError("WebRTC negotiation failed: " + err.message))
        .finally(() => setIsProcessingOffer(false))
    }

    const onStreamerLeft = () => {
      setStatus("Streamer is offline")
      setError("Stream has ended")
    }

    const onStreamPaused = () => {
      setIsStreamPaused(true)
      setIsVideoPlaying(false)
      setStatus("Stream paused — waiting to resume...")
    }

    const onStreamResumed = () => {
      // Streamer will send a fresh offer after resume
      setIsStreamPaused(false)
      setNeedsUserInteraction(false)
      setIsProcessingOffer(false)
      setStatus("Stream resuming — awaiting renegotiation...")
    }

    socket.on("reconnect", onReconnect)
    socket.on("offer", onOffer)
    socket.on("streamer-left", onStreamerLeft)
    socket.on("stream-paused", onStreamPaused)
    socket.on("stream-resumed", onStreamResumed)

    return () => {
      socket.off("reconnect", onReconnect)
      socket.off("offer", onOffer)
      socket.off("streamer-left", onStreamerLeft)
      socket.off("stream-paused", onStreamPaused)
      socket.off("stream-resumed", onStreamResumed)
    }
  }, [
    socket,
    webrtcConnected,
    connectionState,
    isProcessingOffer,
    createAnswer,
    setError,
    handleReconnect
  ])

  // Attach remote stream to <video> and try autoplay
  useEffect(() => {
    if (!remoteStream || !videoRef.current) return

    const video = videoRef.current
    video.srcObject = remoteStream

    video
      .play()
      .then(() => {
        setIsVideoPlaying(true)
        setNeedsUserInteraction(false)
        setIsStreamPaused(false)
        setStatus("Live stream")
      })
      .catch(() => {
        setIsVideoPlaying(false)
        setNeedsUserInteraction(true)
        setStatus("Click to start playback")
      })
  }, [remoteStream])

  // Auto-retry on WebRTC failure/disconnect (with cleanup)
  useEffect(() => {
    const shouldRetry =
      connectionState === "failed" || connectionState === "disconnected"

    if (!shouldRetry) return

    retryCountRef.current += 1

    if (retryCountRef.current > 5) {
      setStatus("WebRTC failed after multiple retries")
      return
    }

    const delay = 2000 * retryCountRef.current

    if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current)

    retryTimeoutRef.current = setTimeout(() => {
      if (!webrtcConnected && !isJoining) void handleReconnect()
    }, delay)

    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
        retryTimeoutRef.current = null
      }
    }
  }, [connectionState, webrtcConnected, isJoining, handleReconnect])

  // Join room when page loads
  useEffect(() => {
    if (roomId && !hasJoinedRoom && !isJoining) void joinRoom()
  }, [roomId, hasJoinedRoom, isJoining, joinRoom])

  // Cleanup only on unmount
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current)
      cleanup()
    }
  }, [cleanup])

  return (
    <div className="mx-auto max-w-300 px-5 py-5 md:px-4">
      {/* Header */}
      <div className="mb-10 text-center">
        <h1 className="mb-2.5 bg-linear-to-br from-blue-500 to-blue-900 bg-clip-text text-[2.5rem] font-semibold text-transparent md:text-[2rem]">
          Viewer Console
        </h1>
        <p className="text-[1.1rem] text-zinc-400">Room ID: {roomId}</p>
      </div>

      {/* Video card */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-sm">
        <div className="relative flex h-100 w-full items-center justify-center overflow-hidden rounded-xl bg-zinc-100">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className={remoteStream && !isStreamPaused ? "block h-full w-full object-cover" : "hidden"}
          />

          {(!remoteStream || isStreamPaused) && (
            <div className="flex h-full w-full items-center justify-center p-5 text-center text-base text-zinc-600">
              {error
                ? "Stream unavailable"
                : isStreamPaused
                  ? "Stream paused — waiting for resume"
                  : "Waiting for stream..."}
            </div>
          )}

          {/* Manual play overlay (autoplay blocked) */}
          {needsUserInteraction && remoteStream && (
            <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
              <button
                onClick={playVideo}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-500/90 px-6 py-3 text-base font-semibold text-white shadow-[0_4px_12px_rgba(59,130,246,0.3)] transition hover:-translate-y-0.5 hover:bg-blue-500"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
                Play Stream
              </button>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            onClick={leaveRoom}
            className="inline-flex items-center justify-center rounded-lg border-2 border-blue-500 bg-transparent px-6 py-3 text-base font-semibold text-blue-500 transition hover:bg-blue-500 hover:text-white"
          >
            Leave Room
          </button>

          {error && (
            <button
              onClick={() => void handleReconnect()}
              disabled={isJoining || isProcessingOffer}
              className="inline-flex items-center justify-center rounded-lg bg-linear-to-br from-blue-500 to-blue-900 px-6 py-3 text-base font-semibold text-white transition hover:-translate-y-0.5 hover:shadow-[0_6px_12px_rgba(59,130,246,0.3)] disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:shadow-none disabled:hover:translate-y-0"
            >
              Reconnect
            </button>
          )}
        </div>
      </div>

      {/* Connection info */}
      <div className="mt-4 rounded-lg bg-zinc-800 p-4">
        <h3 className="mb-2 text-lg font-semibold text-blue-500">Session Info</h3>

        <p className="text-zinc-300">
          <strong className="text-white">Room Status:</strong>{" "}
          {hasJoinedRoom ? "Joined" : "Not joined"}
        </p>

        <p className="text-zinc-300">
          <strong className="text-white">WebRTC Status:</strong> {connectionState}
        </p>

        <p className="text-zinc-300">
          <strong className="text-white">Stream Status:</strong>{" "}
          {isStreamPaused
            ? "Paused"
            : isVideoPlaying
              ? "Playing"
              : remoteStream
                ? "Ready (click play if needed)"
                : "Waiting"}
        </p>
      </div>

      {/* Status banner */}
      <div
        className={[
          "mt-4 rounded-lg border px-4 py-3 font-medium",
          error
            ? "border-red-500/30 bg-red-500/10 text-red-500"
            : webrtcConnected
              ? "border-green-500/30 bg-green-500/10 text-green-500"
              : "border-blue-500/30 bg-blue-500/10 text-blue-500"
        ].join(" ")}
      >
        {error || status}
      </div>
    </div>
  )
}
