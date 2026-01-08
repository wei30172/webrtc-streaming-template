"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { socketManager } from "@/lib/socket"
import { useWebRTC } from "@/hooks/useWebRTC"

export default function StreamerPage() {
  const [roomId, setRoomId] = useState<string | null>(null)
  const [viewerCount, setViewerCount] = useState(0)
  const [status, setStatus] = useState<string>("Ready")
  const [isStreaming, setIsStreaming] = useState(false)
  const [isInitializing, setIsInitializing] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const viewersRef = useRef<Set<string>>(new Set())

  const router = useRouter()
  const socket = socketManager.connect()

  const {
    isConnected,
    error,
    connectionState,
    localStream,
    startLocalStream,
    stopLocalStream,
    createOffer,
    cleanup,
    cleanupViewerConnection,
    setError
  } = useWebRTC({
    socket,
    isStreamer: true
  })

  // Sleep helper
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

  // Wait until socket is connected (with timeout)
  const waitForSocketConnected = useCallback(async (timeoutMs = 5000) => {
    if (socket.connected) return

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.off("connect", onConnect)
        reject(new Error("Socket connection timeout"))
      }, timeoutMs)

      const onConnect = () => {
        clearTimeout(timeout)
        socket.off("connect", onConnect)
        resolve()
      }

      socket.on("connect", onConnect)
    })
  }, [socket])

  // Attach MediaStream to <video> and wait for metadata
  const attachStreamToVideo = useCallback(async (stream: MediaStream) => {
    const maxRetries = 10
    for (let i = 0; i < maxRetries; i++) {
      if (videoRef.current) break
      await sleep(100)
    }

    if (!videoRef.current) {
      throw new Error("Video element initialization failed")
    }

    const video = videoRef.current
    video.srcObject = stream

    await new Promise<void>((resolve, reject) => {
      const onLoadedMetadata = () => {
        video.removeEventListener("loadedmetadata", onLoadedMetadata)
        video.removeEventListener("error", onError)
        resolve()
      }

      const onError = () => {
        video.removeEventListener("loadedmetadata", onLoadedMetadata)
        video.removeEventListener("error", onError)
        reject(new Error("Video loading failed"))
      }

      video.addEventListener("loadedmetadata", onLoadedMetadata)
      video.addEventListener("error", onError)

      if (video.readyState >= 1) onLoadedMetadata()
    })
  }, [])

  // Create a streaming room on the signaling server
  const createRoom = useCallback(async (): Promise<string> => {
    await waitForSocketConnected(5000)

    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Room creation timed out"))
      }, 15000)

      socket.emit("create-room", (response: { roomId: string }) => {
        clearTimeout(timeout)
        resolve(response.roomId)
      })
    })
  }, [socket, waitForSocketConnected])

  // Start camera and attach stream
  const startStreamCore = useCallback(async () => {
    const stream = await startLocalStream()
    if (!stream) throw new Error("Unable to get media stream")
    await attachStreamToVideo(stream)
    setIsStreaming(true)
  }, [startLocalStream, attachStreamToVideo])

  // Initial streaming flow
  const initializeStream = async () => {
    if (isInitializing || isStreaming) return

    try {
      setIsInitializing(true)
      setError(null)
      setStatus("Requesting camera access...")

      await startStreamCore()
      setStatus("Starting camera...")

      const newRoomId = await createRoom()
      setRoomId(newRoomId)
      setStatus("Ready — share the room link to invite viewers")
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Initialization failed"
      setError(msg)
      setStatus("Initialization failed")
      setIsStreaming(false)
    } finally {
      setIsInitializing(false)
    }
  }

  // Stop local media but keep the room alive
  const stopStream = useCallback(() => {
    stopLocalStream()

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }

    setIsStreaming(false)
    setStatus("Stream paused — press Play to resume")

    if (roomId) {
      socket.emit("stream-paused", roomId)
    }
  }, [stopLocalStream, roomId, socket])

  // Restart stream without recreating the room
  const restartStream = useCallback(async () => {
    if (!roomId) {
      setError("Room has expired, please restart streaming")
      return
    }

    try {
      setIsInitializing(true)
      setError(null)
      setStatus("Resuming stream...")

      socket.emit("stream-resumed", roomId)

      await startStreamCore()
      setStatus("Streaming live")

      // Re-send offers to all existing viewers
      viewersRef.current.forEach(viewerId => {
        createOffer(viewerId)
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Stream restart failed"
      setError(msg)
      setStatus("Restart failed")
    } finally {
      setIsInitializing(false)
    }
  }, [roomId, socket, startStreamCore, createOffer, setError])

  // Restore status after a short delay
  const restoreStatus = useCallback(
    (delay = 2000) => {
      setTimeout(() => {
        setStatus(
          isStreaming
            ? "Streaming live"
            : "Ready — waiting for viewers to connect"
        )
      }, delay)
    },
    [isStreaming]
  )

  // Copy viewer link to clipboard
  const copyRoomLink = useCallback(() => {
    if (!roomId) return
    navigator.clipboard.writeText(`${window.location.origin}/viewer/${roomId}`)
    setStatus("Room link copied")
    restoreStatus()
  }, [roomId, restoreStatus])

  // Copy room ID to clipboard
  const copyRoomId = useCallback(() => {
    if (!roomId) return
    navigator.clipboard.writeText(roomId)
    setStatus("Room ID copied")
    restoreStatus()
  }, [roomId, restoreStatus])

  // Handle viewer join / leave events
  useEffect(() => {
    const onViewerJoined = (viewerId: string) => {
      viewersRef.current.add(viewerId)
      setViewerCount(viewersRef.current.size)
      setStatus(`Viewer connected (${viewersRef.current.size} watching)`)
      createOffer(viewerId)
    }

    const onViewerLeft = (viewerId: string) => {
      cleanupViewerConnection(viewerId)
      viewersRef.current.delete(viewerId)
      setViewerCount(viewersRef.current.size)

      setStatus(
        viewersRef.current.size > 0
          ? `Streaming live (${viewersRef.current.size} watching)`
          : "Ready — waiting for viewers to connect"
      )
    }

    socket.on("viewer-joined", onViewerJoined)
    socket.on("viewer-left", onViewerLeft)

    return () => {
      socket.off("viewer-joined", onViewerJoined)
      socket.off("viewer-left", onViewerLeft)
    }
  }, [socket, createOffer, cleanupViewerConnection])

  // Fallback: attach local stream if video lost its srcObject
  useEffect(() => {
    if (localStream && videoRef.current && !videoRef.current.srcObject && !isInitializing) {
      videoRef.current.srcObject = localStream
      if (!isStreaming) setIsStreaming(true)
    }
  }, [localStream, isInitializing, isStreaming])

  // Cleanup on unmount and page unload
  useEffect(() => {
    const handleCleanup = () => cleanup()

    window.addEventListener("beforeunload", handleCleanup)
    return () => {
      window.removeEventListener("beforeunload", handleCleanup)
      handleCleanup()
    }
  }, [cleanup])

  return (
    <div className="mx-auto max-w-300 px-5 py-5 md:px-4">
      {/* Header */}
      <div className="mb-10 text-center">
        <h1 className="mb-2.5 bg-linear-to-br from-blue-500 to-blue-900 bg-clip-text text-[2.5rem] font-semibold text-transparent md:text-[2rem]">
          Streamer Console
        </h1>
        <p className="text-[1.1rem] text-zinc-400">
          Start your camera, create a room, and stream to viewers in real time
        </p>
      </div>

      {/* Video card */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-sm">
        <div className="relative flex h-100 w-full items-center justify-center overflow-hidden rounded-xl bg-zinc-100">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className={isStreaming ? "block h-full w-full object-cover" : "hidden"}
          />

          {!isStreaming && (
            <div className="flex h-full w-full items-center justify-center p-5 text-center text-base text-zinc-600">
              {roomId
                ? "Stream paused — press play to resume"
                : 'Click "Start Streaming" to enable your camera'}
            </div>
          )}
        </div>

        {/* Control buttons */}
        <div className="mt-5 text-center">
          {!isStreaming && !roomId ? (
            <button
              onClick={initializeStream}
              disabled={isInitializing}
              className="inline-flex items-center justify-center rounded-lg bg-linear-to-br from-blue-500 to-blue-900 px-6 py-3 font-semibold text-white transition hover:-translate-y-0.5 hover:shadow-lg disabled:bg-zinc-800"
            >
              {isInitializing ? "Starting..." : "Start Streaming"}
            </button>
          ) : (
            <div className="flex flex-wrap items-center justify-center gap-4">
              <button
                onClick={isStreaming ? stopStream : restartStream}
                title={isStreaming ? "Pause Stream" : "Resume Stream"}
                className={`inline-flex h-12 w-12 items-center justify-center rounded-full text-white transition hover:scale-105 ${
                  isStreaming ? "bg-red-500" : "bg-green-500"
                }`}
              >
                {isStreaming ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16" rx="1" />
                    <rect x="14" y="4" width="4" height="16" rx="1" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>

              <button
                onClick={() => router.push("/")}
                title="Back to Home"
                className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-blue-500 text-white transition hover:scale-105"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
                </svg>
              </button>

              {roomId && (
                <button
                  onClick={copyRoomLink}
                  title="Copy Viewer Link"
                  className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-amber-500 text-white transition hover:scale-105"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Room info */}
      {roomId && (
        <div className="mt-4 rounded-lg bg-zinc-800 p-4">
          <h3 className="mb-2 text-lg font-semibold text-blue-500">Room Details</h3>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-zinc-300">
              <strong className="text-white">Room ID:</strong> {roomId}
            </p>

            <button
              onClick={copyRoomId}
              title="Copy Room ID"
              className="inline-flex h-7 min-w-7 items-center justify-center rounded bg-blue-500 px-1.5 text-white transition hover:bg-blue-600"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
              </svg>
            </button>
          </div>
          <p className="text-zinc-300">
            <strong className="text-white">Viewers Connected:</strong> {viewerCount}
          </p>
          <p className="text-zinc-300">
            <strong className="text-white">WebRTC Status:</strong> {connectionState}
          </p>
        </div>
      )}

      {/* Status banner */}
      <div
        className={[
          "mt-4 rounded-lg border px-4 py-3 font-medium",
          error
            ? "border-red-500/30 bg-red-500/10 text-red-500"
            : isConnected
              ? "border-green-500/30 bg-green-500/10 text-green-500"
              : "border-blue-500/30 bg-blue-500/10 text-blue-500"
        ].join(" ")}
      >
        {error || status}
      </div>
    </div>
  )
}
