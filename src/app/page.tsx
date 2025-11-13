"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Flame, Heart, Copy, Check } from "lucide-react";

export default function Home() {
  const [username, setUsername] = useState("");
  const [mode, setMode] = useState<"roast" | "feedback">("roast");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState(false);

  const handleSubmit = async () => {
    if (!username.trim() || loading) return;
    setLoading(true);
    setResult("");
    setStatus("Starting...");
    setCopied(false);

    try {
      const res = await fetch("/api/roast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, mode }),
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

        // Split by newlines to process complete SSE messages
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const jsonStr = line.slice(6); // Remove "data: " prefix
              const parsed = JSON.parse(jsonStr);

              switch (parsed.type) {
                case "status":
                  setStatus(parsed.content);
                  break;

                case "response_start":
                  setStatus(""); // Clear status when response starts
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

                default:
                  console.log("Unknown event type:", parsed.type);
              }
            } catch (parseError) {
              console.warn("Failed to parse SSE message:", line);
            }
          }
        }
      }
    } catch (error) {
      console.error("Connection error:", error);
      setResult("Failed to connect. Try again.");
      setStatus("");
    } finally {
      setLoading(false);
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

  return (
    <main className="h-screen overflow-hidden bg-gradient-to-br from-slate-900 to-slate-800 p-6">
      <div className="max-w-2xl mx-auto h-full flex flex-col pt-12">
        <div className="flex-shrink-0">
          <h1 className="text-5xl font-bold text-white text-center mb-2">
            AI Roast My GitHub
          </h1>
          <p className="text-gray-400 text-center mb-8">
            Enter your GitHub username. Get roasted or respected.
          </p>
        </div>

        <Card className="flex-1 flex flex-col p-6 bg-slate-800 border-slate-700 overflow-hidden">
          <div className="flex-1 overflow-y-auto mb-6 pr-2 scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800">
            {loading && status && (
              <div className="mb-4 p-3 bg-slate-700 rounded-lg border border-slate-600">
                <p className="text-sm text-blue-400 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 bg-blue-400 rounded-full animate-pulse"></span>
                  {status}
                </p>
              </div>
            )}

            {loading && !result ? (
              <div className="space-y-3">
                <Skeleton className="h-4 w-full bg-slate-700" />
                <Skeleton className="h-4 w-5/6 bg-slate-700" />
                <Skeleton className="h-4 w-4/6 bg-slate-700" />
              </div>
            ) : result ? (
              <div className="relative group">
                <div className="text-lg leading-relaxed text-gray-200 whitespace-pre-wrap select-text prose prose-invert prose-headings:text-white prose-p:text-gray-200 prose-strong:text-white prose-li:text-gray-200 max-w-none">
                  {result}
                </div>
                <Button
                  onClick={handleCopy}
                  variant="ghost"
                  size="icon"
                  className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-700 hover:bg-slate-600"
                  title="Copy to clipboard"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-green-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>
            ) : (
              <p className="text-center text-slate-500 italic pt-12">
                Your GitHub sins will be exposed here...
              </p>
            )}
          </div>

          <div className="flex-shrink-0">
            <div className="flex justify-center mb-4">
              <ToggleGroup
                type="single"
                value={mode}
                onValueChange={(v) => v && setMode(v as any)}
              >
                <ToggleGroupItem
                  value="roast"
                  className="flex items-center gap-2"
                >
                  <Flame className="w-4 h-4" /> Roast
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="feedback"
                  className="flex items-center gap-2"
                >
                  <Heart className="w-4 h-4" /> Feedback
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div className="flex gap-3">
              <Input
                placeholder="Github Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                className="flex-1 bg-slate-900 border-slate-600 text-white placeholder:text-slate-500 select-text"
                disabled={loading}
              />
              <Button
                onClick={handleSubmit}
                disabled={loading}
                className="px-8"
              >
                {loading ? "Analyzing..." : "Go"}
              </Button>
            </div>
          </div>
        </Card>

        <p className="flex-shrink-0 text-center text-xs text-slate-500 mt-6">
          Built with Next.js • GitHub API • OpenAI • shadcn/ui
        </p>
      </div>
    </main>
  );
}
