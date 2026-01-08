import { useEffect, useRef, useState, useMemo, useCallback } from "react"
import { Socket } from "socket.io-client"

interface UseWebRTCProps {
  socket: Socket | null
  isStreamer: boolean
}

export const useWebRTC = ({ socket, isStreamer }: UseWebRTCProps) => {
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>("new")
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)

  const peerConnection = useRef<RTCPeerConnection | null>(null)
  const localStream = useRef<MediaStream | null>(null)
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map())
  const processingOffers = useRef<Set<string>>(new Set())

  // ICE server configuration
  const iceServers = useMemo(
    () => [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" }
    ], []
  )

  // Create a PeerConnection for the viewer (streamer side)
  const createPeerConnectionForViewer = useCallback((viewerId: string) => {
      // Clean up existing connection if it already exists
      if (peerConnections.current.has(viewerId)) {
        const oldPc = peerConnections.current.get(viewerId)!
        oldPc.close()
        peerConnections.current.delete(viewerId)
      }

      const pc = new RTCPeerConnection({ iceServers })

      // Listen for connection state changes
      pc.onconnectionstatechange = () => {
        console.log(`Viewer ${viewerId} connection status:`, pc.connectionState)

        // Streamer: derive overall state from all viewer connections
        if (isStreamer) {
          const allConnections = Array.from(peerConnections.current.values())
          const hasConnectedViewer = allConnections.some(conn => conn.connectionState === "connected")

          if (hasConnectedViewer) {
            setConnectionState("connected")
            setIsConnected(true)
          } else if (allConnections.length > 0) {
            const states = allConnections.map(conn => conn.connectionState)
            const hasConnecting = states.includes("connecting")
            if (hasConnecting) {
              setConnectionState("connecting")
              setIsConnected(false)
            } else {
              setConnectionState("disconnected")
              setIsConnected(false)
            }
          } else {
            setConnectionState("new")
            setIsConnected(false)
          }
        } else {
          // Viewer: use the single PeerConnection state
          setConnectionState(pc.connectionState)
          setIsConnected(pc.connectionState === "connected")
        }
      }

      // Handle ICE candidates
      pc.onicecandidate = event => {
        if (event.candidate && socket) {
          console.log(`Sending ICE candidate to viewer ${viewerId}`)
          socket.emit("ice-candidate", {
            candidate: event.candidate,
            target: viewerId
          })
        }
      }

      // Handle ICE candidate errors
      pc.onicecandidateerror = event => {
        console.error(`Viewer ${viewerId} ICE candidate error:`, event)
      }

      peerConnections.current.set(viewerId, pc)
      return pc
    },
    [socket, iceServers, isStreamer]
  )

  // Acquire local media stream (streamer)
  const startLocalStream = useCallback(async () => {
    if (!isStreamer) return

    try {
      // Check browser support
      if (
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
      ) {
        throw new Error("Your browser does not support camera functionality")
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        },
        audio: true
      })

      // console.log("Video tracks:", stream.getVideoTracks())
      // console.log("Audio tracks:", stream.getAudioTracks())

      if (stream.getVideoTracks().length === 0) {
        throw new Error("Unable to get video track")
      }

      localStream.current = stream
      return stream
    } catch (err) {
      let errorMessage = "Unable to get media devices"

      if (err instanceof Error) {
        if (err.name === "NotAllowedError") {
          errorMessage =
            "Camera permission denied, please allow camera access"
        } else if (err.name === "NotFoundError") {
          errorMessage = "Camera device not found"
        } else if (err.name === "NotReadableError") {
          errorMessage = "The camera is being used by another application"
        } else {
          errorMessage = err.message
        }
      }

      console.error(
        "Failed to acquire media stream:",
        errorMessage,
        err
      )
      setError(errorMessage)
      throw new Error(errorMessage)
    }
  }, [isStreamer])

  // Create Offer (streamer)
  const createOffer = useCallback(async (viewerId: string) => {
      console.log("Creating Offer for viewer:", viewerId)
      if (!socket || !isStreamer) return

      // Ensure local stream is ready
      if (!localStream.current) {
        setError("Local stream not ready")
        return
      }

      console.log(
        "Local stream ready, track count:",
        localStream.current.getTracks().length
      )

      try {
        // Create a dedicated PeerConnection for this viewer
        const pc = createPeerConnectionForViewer(viewerId)

        // Add tracks if they are not already added
        const tracks = localStream.current.getTracks()
        const existingSenders = pc.getSenders()

        tracks.forEach(track => {
          const existingSender = existingSenders.find(sender => sender.track === track)

          if (!existingSender) {
            pc.addTrack(track, localStream.current!)
          } else {
            console.log("Track already exists, skipping:", track.kind,track.id)
          }
        })

        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)

        socket.emit("offer", {
          offer,
          target: viewerId
        })
        console.log("Offer sent to viewer:", viewerId)
      } catch (err) {
        const errorMessage =
          err instanceof Error
            ? err.message
            : "Failed to create Offer"
        console.error("Failed to create Offer:", errorMessage)
        setError(errorMessage)
      }
    },
    [socket, isStreamer, createPeerConnectionForViewer]
  )

  // Create Answer (viewer)
  const createAnswer = useCallback(async (offer: RTCSessionDescriptionInit, streamerId: string) => {
      // Prevent processing the same offer multiple times
      if (processingOffers.current.has(streamerId)) {
        console.log(`Already processing offer from ${streamerId}, skipping.`)
        return
      }

      // Clean up failed or closed connections
      if (peerConnection.current) {
        const state = peerConnection.current.connectionState
        if (
          state === "failed" ||
          state === "closed" ||
          state === "disconnected"
        ) {
          console.log("Connection in terminal state, clearing for a fresh start.")
          peerConnection.current.close()
          peerConnection.current = null
        }
      }

      // Initialize PeerConnection if needed
      if (!peerConnection.current) {
        const pc = new RTCPeerConnection({ iceServers })

        // Listen for connection state changes
        pc.onconnectionstatechange = () => {
          if (peerConnection.current) {
            setConnectionState(pc.connectionState)
            setIsConnected(pc.connectionState === "connected")
          }
        }

        // Handle ICE candidates
        pc.onicecandidate = event => {
          if (event.candidate && socket) {
            socket.emit("ice-candidate", {
              candidate: event.candidate,
              target: streamerId
            })
          }
        }

        // Handle remote stream
        pc.ontrack = event => {
          if (event.streams.length > 0) {
            setRemoteStream(event.streams[0])
          }
        }

        peerConnection.current = pc
      }

      try {
        processingOffers.current.add(streamerId)

        // Ensure signaling state is stable
        if (peerConnection.current.signalingState !=="stable") {
          return
        }

        await peerConnection.current.setRemoteDescription(offer)
        const answer = await peerConnection.current.createAnswer()
        await peerConnection.current.setLocalDescription(answer)

        socket?.emit("answer", {
          answer,
          target: streamerId
        })
      } catch (err) {
        console.error("Failed to create answer:", err)
        setError(
          err instanceof Error
            ? err.message
            : "WebRTC Answer Error"
        )
      } finally {
        processingOffers.current.delete(streamerId)
      }
    },
    [socket, iceServers]
  )

  // Handle Answer (streamer)
  const handleAnswer = useCallback(async (answer: RTCSessionDescriptionInit, viewerId: string) => {
      if (!isStreamer) return

      const pc = peerConnections.current.get(viewerId)
      if (!pc) return

      try {
        await pc.setRemoteDescription(answer)
      } catch (err) {
        const errorMessage =
          err instanceof Error
            ? err.message
            : "Failed to handle Answer"
        setError(errorMessage)
      }
    },
    [isStreamer]
  )

  // Handle ICE candidates
  const handleIceCandidate = useCallback(async (candidate: RTCIceCandidateInit, senderId: string) => {
      try {
        if (isStreamer) {
          // Streamer: receive ICE candidate from a specific viewer
          const pc = peerConnections.current.get(senderId)
          if (pc) {
            await pc.addIceCandidate(candidate)
          }
        } else {
          // Viewer: receive ICE candidate from the streamer
          if (peerConnection.current) {
            await peerConnection.current.addIceCandidate(candidate)
          }
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error
            ? err.message
            : "Failed to add ICE candidate"
        setError(errorMessage)
      }
    },
    [isStreamer]
  )

  // Clean up all resources
  const cleanup = useCallback(() => {
    // Stop local media tracks
    if (localStream.current) {
      localStream.current
        .getTracks()
        .forEach(track => track.stop())
      localStream.current = null
    }

    // Clean up main PeerConnection (viewer side)
    if (peerConnection.current) {
      peerConnection.current.onconnectionstatechange = null
      peerConnection.current.onicecandidate = null
      peerConnection.current.ontrack = null
      peerConnection.current.close()
      peerConnection.current = null
    }

    // Clean up all viewer PeerConnections (streamer side)
    peerConnections.current.forEach(pc => {
      pc.onconnectionstatechange = null
      pc.close()
    })
    peerConnections.current.clear()

    // Reset all state
    processingOffers.current.clear()
    setRemoteStream(null)
    setIsConnected(false)
    setConnectionState("new")
    setError(null)
  }, [])

  // Socket event listeners
  useEffect(() => {
    if (!socket) return

    socket.on("offer", ({ offer, sender }) => {
      createAnswer(offer, sender)
    })

    socket.on("answer", ({ answer, sender }) => {
      handleAnswer(answer, sender)
    })

    socket.on("ice-candidate", ({ candidate, sender }) => {
      handleIceCandidate(candidate, sender)
    })

    return () => {
      socket.off("offer")
      socket.off("answer")
      socket.off("ice-candidate")
    }
  }, [socket, createAnswer, handleAnswer, handleIceCandidate])

  // Stop local stream
  const stopLocalStream = useCallback(() => {
    if (localStream.current) {
      localStream.current.getTracks().forEach(track => {
        track.stop()
        console.log("Stopping track:", track.kind)
      })
      localStream.current = null
    }
  }, [])

  // Clean up a specific viewer connection
  const cleanupViewerConnection = useCallback((viewerId: string) => {
      const pc = peerConnections.current.get(viewerId)
      if (pc) {
        pc.close()
        peerConnections.current.delete(viewerId)

        // Recalculate overall connection state
        if (isStreamer) {
          const allConnections = Array.from(peerConnections.current.values())
          const hasConnectedViewer = allConnections.some(conn => conn.connectionState === "connected")

          if (hasConnectedViewer) {
            setConnectionState("connected")
            setIsConnected(true)
          } else if (allConnections.length > 0) {
            setConnectionState("connecting")
            setIsConnected(false)
          } else {
            setConnectionState("new")
            setIsConnected(false)
          }
        }
      }
    },
    [isStreamer]
  )

  return {
    isConnected,
    error,
    connectionState,
    localStream: localStream.current,
    remoteStream,
    startLocalStream,
    stopLocalStream,
    createOffer,
    createAnswer,
    cleanup,
    cleanupViewerConnection,
    setError
  }
}
