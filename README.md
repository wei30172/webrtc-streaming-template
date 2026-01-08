# Frontend WebRTC Streaming Template

A **frontend-focused WebRTC starter template** built with **Next.js App Router** and **TypeScript**, demonstrating how to implement real-time video streaming and remote viewing using WebRTC.

---
## ✨ Key Features

- ✅ **Real-time Video Streaming (WebRTC)** — Low-latency peer-to-peer media streaming with support for one-to-many broadcasting (single streamer, multiple viewers).
- ✅ **Frontend-Centric WebRTC Architecture** — WebRTC lifecycle and peer connection logic are encapsulated in a custom React Hook, with a clear separation between UI components, signaling, and WebRTC state management.
- ✅ **Complete Signaling Flow** — Full SDP (Session Description Protocol) Offer / Answer exchange and ICE candidate handling via Socket.io.
- ✅ **Stream Control** — Streamer-side controls for pausing and resuming media tracks, with state synchronization across connected viewers.
- ✅ **Local & Public Network Ready** — Works in local network environments and supports public access through tools like ngrok for remote testing and demos.

## 🧩 Tech Stack

| Category | Technology |
|------|------|
| Framework | Next.js (App Router) |
| Language | TypeScript |
| WebRTC | Native WebRTC APIs |
| Signaling | Socket.io |
| State / Logic | React Hooks |
| Deployment | Local / ngrok |

## 🚀 Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Start Development Server

```bash
npm run dev
```

The app will be available at: [http://localhost:3000](http://localhost:3000)。

### 3. How It Works (User Flow)

#### Streamer (Camera Side)
1. Open the homepage
2. Click Start Streaming
3. Grant camera permissions
4. A Room ID will be generated
5. Share the Room ID with viewers
6. Pause / resume the stream anytime

#### Viewer (Remote Client)
1. Open the homepage
2. Enter the provided Room ID
3. Connect to the stream
4. Watch the real-time video feed

## 🗂️ Project Structure

```
webrtc-streaming-template/
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Root layout
│   │   ├── page.tsx            # Entry page
│   │   ├── globals.css         # Global styles
│   │   ├── streamer/
│   │   │   └── page.tsx        # Streamer UI
│   │   └── viewer/
│   │       └── [roomId]/
│   │           └── page.tsx    # Viewer UI
│   ├── hooks/
│   │   └── useWebRTC.ts        # Core WebRTC logic
│   ├── lib/
│   │   └── socket.ts           # Socket.io client
├── server.js                   # Socket.io signaling server
├── package.json
├── tsconfig.json
├── next.config.js
└── README.md
```

## 🚀 Public Access with ngrok

### 1. Install ngrok
```bash
brew install ngrok/ngrok/ngrok
```

### 2. Sign up and obtain an authtoken

1. Visit the [ngrok website](https://ngrok.com) and create an account
2. Go to your [authtoken page](https://dashboard.ngrok.com/get-started/your-authtoken) to copy your authtoken

### 3. Configure the authtoken

```bash
ngrok config add-authtoken YOUR_AUTHTOKEN_HERE
```

### 4. Create a public tunnel

```bash
ngrok http http://localhost:3000
```

Or specify a custom domain (paid plan required):

```bash
ngrok http http://localhost:3000 --domain=https://your-name.ngrok-free.app
```

### 5. Get the public URL

After ngrok starts successfully, you should see output similar to:
```bash
Forwarding https://your-name.ngrok-free.app -> http://localhost:3000
```

Add this URL to your .env.local file:
```bash
NEXT_PUBLIC_APP_URL=https://your-name.ngrok-free.app
```

### 6. Start commands:

**Option 1: Start the development server and ngrok tunnel together**
```bash
npm run dev:ngrok
```

**Option 2: Start the production server and ngrok tunnel together**
```bash
npm run start:ngrok
```

**Option 3: Start them separately**
```bash
# Terminal 1: start the application
npm run dev

# Terminal 2: start the ngrok tunnel
npm run ngrok
```

## Environment Variables
Create .env.local:

```
NODE_ENV=development
HOSTNAME=localhost
PORT=3000
NEXT_PUBLIC_APP_URL=https://your-name.ngrok-free.app
```
