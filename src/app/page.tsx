"use client";

import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Flame, Heart, Copy, Check, Zap, Square } from "lucide-react";
import ReactMarkdown from "react-markdown";

function CreativeLoader() {
  return (
    <div className="space-y-6">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex gap-4 items-start animate-pulse">
          <div
            className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex-shrink-0 animate-spin"
            style={{ animationDuration: `${2 + i}s` }}
          />
          <div className="flex-1 space-y-3">
            <div
              className="h-4 bg-gradient-to-r from-slate-700 via-slate-600 to-slate-700 rounded-lg w-3/4"
              style={{ animationDelay: `${i * 0.1}s` }}
            />
            <div
              className="h-4 bg-gradient-to-r from-slate-700 via-slate-600 to-slate-700 rounded-lg w-full"
              style={{ animationDelay: `${i * 0.2}s` }}
            />
            <div
              className="h-4 bg-gradient-to-r from-slate-700 via-slate-600 to-slate-700 rounded-lg w-5/6"
              style={{ animationDelay: `${i * 0.3}s` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const [username, setUsername] = useState("");
  const [mode, setMode] = useState("roast");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState(false);

  const controllerRef = useRef<AbortController | null>(null);

  const handleSubmit = async () => {
    if (!username.trim() || loading) return;

    controllerRef.current = new AbortController();

    setLoading(true);
    setResult("");
    setStatus("Starting...");
    setCopied(false);

    try {
      const res = await fetch("/api/roast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, mode }),
        signal: controllerRef.current.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        setResult(`Error: ${text}`);
        setStatus("");
        setLoading(false);
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const jsonStr = line.slice(6);
              const parsed = JSON.parse(jsonStr);

              switch (parsed.type) {
                case "status":
                  setStatus(parsed.content);
                  break;

                case "response_start":
                  setStatus("");
                  break;

                case "response_chunk":
                  setResult((prev) => prev + parsed.content);
                  break;

                case "response_end":
                  setLoading(false);
                  setStatus("");
                  break;

                case "error":
                  setResult(parsed.content);
                  setStatus("");
                  setLoading(false);
                  break;
              }
            } catch (parseError) {
              console.warn("Failed to parse SSE message:", line);
            }
          }
        }
      }
    } catch (error: any) {
      if (error?.name === "AbortError") {
        setStatus("Stopped by user");
        setLoading(false);
      } else {
        console.error("Connection error:", error);
        setResult("Failed to connect. Try again.");
        setStatus("");
        setLoading(false);
      }
    } finally {
      controllerRef.current = null;
    }
  };

  const handleStop = () => {
    if (controllerRef.current) {
      controllerRef.current.abort();
      setLoading(false);
      setStatus("Stopped");
    }
  };

  const handleCopy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  useEffect(() => {
    const abort = () => {
      controllerRef.current?.abort();
    };

    window.addEventListener("beforeunload", abort);
    window.addEventListener("pagehide", abort);

    return () => {
      window.removeEventListener("beforeunload", abort);
      window.removeEventListener("pagehide", abort);
      abort();
    };
  }, []);

  return (
    <main className="h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 relative overflow-hidden">
      {/* Animated background effect */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse" />
        <div
          className="absolute bottom-0 right-1/4 w-96 h-96 bg-pink-500/10 rounded-full blur-3xl animate-pulse"
          style={{ animationDelay: "1s" }}
        />
      </div>

      <div className="max-w-3xl mx-auto h-full flex flex-col relative z-10">
        <div className="flex-shrink-0 pt-8 pb-6">
          <div className="flex items-center justify-center gap-3 mb-3">
            <Zap className="w-10 h-10 text-yellow-400 animate-pulse" />
            <h1 className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-400 to-red-400 text-center">
              GitHub Roaster
            </h1>
            <Zap
              className="w-10 h-10 text-yellow-400 animate-pulse"
              style={{ animationDelay: "0.5s" }}
            />
          </div>
          <p className="text-gray-400 text-center text-lg">
            Enter your GitHub username. Get{" "}
            <span className="text-red-400 font-semibold">roasted</span> or{" "}
            <span className="text-green-400 font-semibold">respected</span>.
          </p>
        </div>

        <Card className="flex-1 flex flex-col p-6 bg-slate-900/80 backdrop-blur-xl border-2 border-slate-700/50 shadow-2xl shadow-purple-500/10 min-h-0">
          <div
            className="flex-1 overflow-y-auto mb-6 pr-2 min-h-0"
            style={{
              scrollbarWidth: "thin",
              scrollbarColor: "#6b7280 #1e293b",
            }}
          >
            {loading && status && (
              <div className="mb-6 p-4 bg-gradient-to-r from-purple-900/30 to-pink-900/30 rounded-xl border border-purple-500/30 backdrop-blur-sm">
                <p className="text-sm text-purple-300 flex items-center gap-3">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-purple-500"></span>
                  </span>
                  {status}
                </p>
              </div>
            )}

            {loading && !result ? (
              <CreativeLoader />
            ) : result ? (
              <div className="relative">
                {/* Sticky Copy Button - Top Right, Always Visible */}
                <div className="sticky top-4 z-10 flex justify-end mb-2">
                  <Button
                    onClick={handleCopy}
                    variant="ghost"
                    size="icon"
                    className="bg-slate-800/90 hover:bg-slate-700/90 backdrop-blur-sm border border-slate-600 shadow-lg rounded-full p-2 cursor-pointer transition-all hover:scale-110"
                    title="Copy to clipboard"
                  >
                    {copied ? (
                      <Check className="w-5 h-5 text-green-400" />
                    ) : (
                      <Copy className="w-5 h-5 text-gray-300" />
                    )}
                  </Button>
                </div>

                {/* Markdown Content */}
                <div
                  className="prose prose-invert prose-lg max-w-none 
                  prose-headings:text-transparent prose-headings:bg-clip-text prose-headings:bg-gradient-to-r prose-headings:from-purple-400 prose-headings:to-pink-400
                  prose-p:text-gray-100 prose-p:leading-relaxed
                  prose-strong:text-yellow-300 prose-strong:font-bold
                  prose-em:text-pink-300
                  prose-code:text-green-300 prose-code:bg-slate-800 prose-code:px-2 prose-code:py-1 prose-code:rounded
                  prose-li:text-gray-100
                  prose-a:text-blue-400 prose-a:no-underline hover:prose-a:text-blue-300
                  text-gray-100"
                >
                  <ReactMarkdown>{result}</ReactMarkdown>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full space-y-4">
                <div className="text-8xl opacity-20">🔥</div>
                <p className="text-center text-slate-500 italic text-lg">
                  Your GitHub sins will be exposed here...
                </p>
              </div>
            )}
          </div>

          <div className="flex-shrink-0 space-y-4">
            <div className="flex justify-center">
              <ToggleGroup
                type="single"
                value={mode}
                onValueChange={(v) => v && setMode(v)}
                className="bg-slate-800/50 p-1 rounded-lg border border-slate-700"
              >
                <ToggleGroupItem
                  value="roast"
                  className="flex items-center gap-2 data-[state=on]:bg-gradient-to-r data-[state=on]:from-red-600 data-[state=on]:to-orange-600 data-[state=on]:text-white transition-all cursor-pointer hover:scale-105"
                >
                  <Flame className="w-4 h-4" /> Roast
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="feedback"
                  className="flex items-center gap-2 data-[state=on]:bg-gradient-to-r data-[state=on]:from-green-600 data-[state=on]:to-emerald-600 data-[state=on]:text-white transition-all cursor-pointer hover:scale-105"
                >
                  <Heart className="w-4 h-4" /> Feedback
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div className="flex gap-3">
              <Input
                placeholder="GitHub Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && !loading && handleSubmit()
                }
                disabled={loading}
                className="flex-1 bg-slate-800/50 border-2 border-slate-600 text-white placeholder:text-slate-500 
                          focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all
                          selection:bg-purple-500/30 selection:text-white h-12 text-lg"
              />
              {loading ? (
                <Button
                  onClick={handleStop}
                  className="px-8 h-12 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 
                            text-white font-bold shadow-lg shadow-red-500/30 transition-all hover:scale-105 
                            cursor-pointer border-0"
                >
                  <span className="flex items-center gap-2">
                    <Square className="w-4 h-4" />
                    Stop
                  </span>
                </Button>
              ) : (
                <Button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="px-8 h-12 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 
                            text-white font-bold shadow-lg shadow-purple-500/30 transition-all hover:scale-105 
                            disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer border-0"
                >
                  Fire 🔥
                </Button>
              )}
            </div>
          </div>
        </Card>

        <p className="flex-shrink-0 text-center text-xs text-slate-600 mt-4">
          Built with Next.js • GitHub API • Vercel AI SDK
        </p>
      </div>
    </main>
  );
}
