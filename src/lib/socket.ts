import { io, Socket } from "socket.io-client"

class SocketManager {
  private socket: Socket | null = null
  private connecting: boolean = false

  connect(): Socket {
    // If a socket already exists and is connected, return it directly
    if (this.socket && this.socket.connected) {
      return this.socket
    }

    // If a connection attempt is already in progress, reuse the existing socket
    if (this.connecting) {
      return this.socket!
    }

    // Prevent duplicate connection attempts
    this.connecting = true

    // Clean up any existing socket before creating a new one
    if (this.socket) {
      this.socket.removeAllListeners()
      this.socket.disconnect()
      this.socket = null
    }

    console.log("Establishing new Socket connection...")

    // Dynamically determine the server URL
    const getServerUrl = (): string => {
      if (typeof window !== "undefined") {
        // Development environment
        if (
          window.location.hostname === "localhost" ||
          window.location.hostname === "127.0.0.1"
        ) {
          return `${window.location.protocol}//${window.location.hostname}:3000`
        }
        // Production environment: use current protocol and host
        return `${window.location.protocol}//${window.location.host}`
      }
      // Fallback for server-side usage
      return "http://localhost:3000"
    }

    const serverUrl = getServerUrl()
    console.log("Socket connecting to:", serverUrl)

    this.socket = io(serverUrl, {
      transports: ["websocket", "polling"],
      timeout: 30000, // Wait up to 30 seconds for connection
      autoConnect: true,
      forceNew: false, // Allow connection reuse to reduce unnecessary reconnects
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 10,
      randomizationFactor: 0.5
    })

    // Register connection-related event listeners
    this.socket.on("connect", () => {
      console.log("Socket connected, ID:", this.socket?.id)
      this.connecting = false
    })

    this.socket.on("disconnect", (reason) => {
      console.log("Socket disconnected, reason:", reason)
      this.connecting = false
    })

    this.socket.on("connect_error", (error) => {
      console.error("Socket connection error:", error)
      this.connecting = false
    })

    this.socket.on("reconnect", (attemptNumber) => {
      console.log(
        "Socket reconnected successfully, attempt:",
        attemptNumber
      )
      this.connecting = false
    })

    this.socket.on("reconnect_failed", () => {
      console.error("Socket reconnection failed")
      this.connecting = false
    })

    return this.socket
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }
  }

  getSocket(): Socket | null {
    return this.socket
  }
}

export const socketManager = new SocketManager()
