"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Flame, Heart } from "lucide-react";

export default function Home() {
  const [username, setUsername] = useState("");
  const [mode, setMode] = useState<"roast" | "feedback">("roast");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!username.trim()) return;
    setLoading(true);
    setResult("");

    const res = await fetch("/api/roast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, mode }),
    });

    const data = await res.json();
    setResult(data.roast || data.error || "No public repos found.");
    setLoading(false);
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-6">
      <div className="max-w-2xl mx-auto pt-20">
        <h1 className="text-5xl font-bold text-white text-center mb-2">
          AI Roast My GitHub
        </h1>
        <p className="text-gray-400 text-center mb-10">
          Enter your GitHub username. Get roasted or respected.
        </p>

        <Card className="p-6 bg-slate-800 border-slate-700">
          <div className="flex gap-3 mb-6">
            <Input
              placeholder="Github Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              className="flex-1 bg-slate-900 border-slate-600 text-white placeholder:text-slate-500"
            />
            <Button onClick={handleSubmit} disabled={loading} className="px-8">
              {loading ? "Analyzing..." : "Go"}
            </Button>
          </div>

          <div className="flex justify-center mb-6">
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

          <div className="min-h-48">
            {loading ? (
              <div className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-4/6" />
              </div>
            ) : result ? (
              <p className="text-lg leading-relaxed text-gray-200 whitespace-pre-wrap">
                {result}
              </p>
            ) : (
              <p className="text-center text-slate-500 italic">
                Your GitHub sins will be exposed here...
              </p>
            )}
          </div>
        </Card>

        <p className="text-center text-xs text-slate-500 mt-8">
          Built with Next.js • GitHub API • OpenAI • shadcn/ui
        </p>
      </div>
    </main>
  );
}
