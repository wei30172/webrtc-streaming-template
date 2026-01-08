"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export default function Home() {
  const [roomId, setRoomId] = useState("")
  const router = useRouter()

  const createRoom = () => {
    router.push("/streamer")
  }

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (roomId.trim()) {
      router.push(`/viewer/${roomId}`)
    }
  }

  return (
    <div className="mx-auto max-w-300 px-5 py-5 md:px-4">
      <div className="mb-10 text-center">
        <h1 className="mb-2.5 text-[2.5rem] font-semibold text-transparent bg-clip-text bg-linear-to-br from-blue-500 to-blue-900 md:text-[2rem]">
          WebRTC Live Streaming Demo
        </h1>
        <p className="text-[1.1rem] text-zinc-400">
          A simple Streamer & Viewer UI for testing real-time video over WebRTC
        </p>
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-sm">
          <h2 className="mb-4 text-xl font-semibold text-blue-500">
            Streamer (Send Video)
          </h2>

          <p className="mb-5 text-zinc-300">
            Start your camera and create a room link for viewers to join.
          </p>

          <div className="mb-5 rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
            <h4 className="mb-3 text-[15px] font-semibold text-blue-500">
              🔧 How it works
            </h4>
            <div className="space-y-1 text-[15px] leading-7 text-zinc-400">
              <p>1. Click &quot;Start Streaming&quot;</p>
              <p>2. Allow camera (and microphone if enabled)</p>
              <p>3. Copy the Room ID or the Viewer link</p>
              <p>4. Share it with anyone who wants to watch</p>
            </div>
          </div>

          <button
            className="m-2 inline-flex items-center justify-center rounded-lg bg-linear-to-br from-blue-500 to-blue-900 px-6 py-3 text-base font-semibold text-white transition hover:-translate-y-0.5 hover:shadow-[0_6px_12px_rgba(59,130,246,0.3)] disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:shadow-none disabled:hover:translate-y-0"
            onClick={createRoom}
          >
            Start Streaming
          </button>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-sm">
          <h2 className="mb-4 text-xl font-semibold text-blue-500">
            Viewer (Watch Stream)
          </h2>

          <p className="mb-5 text-zinc-300">
            Enter a Room ID to connect and watch the live stream.
          </p>

          <div className="mb-5 rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
            <h4 className="mb-3 text-[15px] font-semibold text-blue-500">
              🎮 Steps
            </h4>
            <div className="space-y-1 text-[15px] leading-7 text-zinc-400">
              <p>1. Get the Room ID from the streamer</p>
              <p>2. Paste it below</p>
              <p>3. Click &quot;Join Stream&quot;</p>
              <p>4. If autoplay is blocked, press play</p>
            </div>
          </div>

          <form onSubmit={handleJoinSubmit} className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Enter Room ID"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="w-full flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 text-base text-white placeholder:text-zinc-500 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />

            <button
              type="submit"
              disabled={!roomId.trim()}
              className="inline-flex items-center justify-center whitespace-nowrap rounded-lg bg-linear-to-br from-blue-500 to-blue-900 px-6 py-3 text-base font-semibold text-white transition hover:-translate-y-0.5 hover:shadow-[0_6px_12px_rgba(59,130,246,0.3)] disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:shadow-none disabled:hover:translate-y-0"
            >
              Join Stream
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
