const { createServer } = require("http")
const { parse } = require("url")
const next = require("next")
const { Server } = require("socket.io")

const dev = process.env.NODE_ENV !== "production"
const hostname = process.env.HOSTNAME || (dev ? "localhost" : "0.0.0.0")
const port = parseInt(process.env.PORT || "3000", 10)

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const httpServer = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true)
      await handle(req, res, parsedUrl)
    } catch (err) {
      console.error("Error occurred handling", req.url, err)
      res.statusCode = 500
      res.end("internal server error")
    }
  })

  // Build allowed CORS origins
  const allowedOrigins = [
    "http://localhost:3000",
    process.env.NEXT_PUBLIC_APP_URL
  ].filter(Boolean)

  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      methods: ["GET", "POST"],
      credentials: true
    },
    allowEIO3: true,
    transports: ["websocket", "polling"]
  })

  // Store room state
  const rooms = new Map()

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id)

    // Create a new room
    socket.on("create-room", (callback) => {
      // Use a fixed room ID in development, random ID in production
      const isDevelopment = process.env.NODE_ENV !== "production"
      const DEV_ROOM_ID = "dev-room-001"
      const roomId = isDevelopment
        ? DEV_ROOM_ID
        : Math.random().toString(36).substring(2, 15)

      rooms.set(roomId, {
        streamer: socket.id,
        viewers: new Set()
      })

      socket.join(roomId)
      console.log(`Room ${roomId} created, streamer: ${socket.id}`)
      callback({ roomId })
    })

    // Join an existing room as a viewer
    socket.on("join-room", (roomId, callback) => {
      const room = rooms.get(roomId)
      if (!room) {
        callback({ error: "Room does not exist" })
        return
      }

      // Prevent duplicate joins
      if (room.viewers.has(socket.id)) {
        callback({ success: true })
        return
      }

      room.viewers.add(socket.id)
      socket.join(roomId)

      console.log(`Viewer ${socket.id} joined room ${roomId}`)
      console.log(`Viewer count:`, room.viewers.size)

      // Notify streamer that a new viewer has joined
      socket.to(room.streamer).emit("viewer-joined", socket.id)
      callback({ success: true })
    })

    // WebRTC signaling: offer
    socket.on("offer", (data) => {
      socket.to(data.target).emit("offer", {
        offer: data.offer,
        sender: socket.id
      })
    })

    // WebRTC signaling: answer
    socket.on("answer", (data) => {
      socket.to(data.target).emit("answer", {
        answer: data.answer,
        sender: socket.id
      })
    })

    // WebRTC signaling: ICE candidate
    socket.on("ice-candidate", (data) => {
      socket.to(data.target).emit("ice-candidate", {
        candidate: data.candidate,
        sender: socket.id
      })
    })

    // Stream pause event
    socket.on("stream-paused", (roomId) => {
      console.log(`Stream paused in room ${roomId}`)
      socket.to(roomId).emit("stream-paused")
    })

    // Stream resume event
    socket.on("stream-resumed", (roomId) => {
      console.log(`Stream resumed in room ${roomId}`)
      socket.to(roomId).emit("stream-resumed")
    })

    // Handle disconnect
    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id)

      // Clean up room state
      for (const [roomId, room] of rooms.entries()) {
        if (room.streamer === socket.id) {
          // If streamer leaves, close the room and notify viewers
          socket.to(roomId).emit("streamer-left")
          rooms.delete(roomId)
          console.log(`Room ${roomId} closed`)
        } else if (room.viewers.has(socket.id)) {
          // If viewer leaves, remove from room and notify streamer
          room.viewers.delete(socket.id)
          socket.to(room.streamer).emit("viewer-left", socket.id)
        }
      }
    })
  })

  httpServer
    .once("error", (err) => {
      console.error("❌ Server error:", err)
      process.exit(1)
    })
    .listen(port, hostname, () => {
      console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`)
      console.log(`🚀 Server running at: http://${hostname}:${port}`)
      console.log(`🌐 Public app url: ${process.env.NEXT_PUBLIC_APP_URL}`)
    })
})
