import { NextRequest } from "next/server";
import { Octokit } from "@octokit/rest";
import { streamText } from "ai";
import { groq } from "@ai-sdk/groq";

// import { openai } from "@ai-sdk/openai";
// const model = openai("gpt-4o-mini");

// import { google } from "@ai-sdk/google";
// const model = google("gemini-2.0-flash-exp");

const model = groq("llama-3.3-70b-versatile");

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

interface RepoSummary {
  name: string;
  description: string | null;
  language: string | null;
  recentCommits: string[];
  packageJson?: any;
  readmeSnippet?: string;
}

export async function POST(req: NextRequest) {
  try {
    const { username, mode } = await req.json();
    if (!username) {
      return new Response("Username required", { status: 400 });
    }

    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    const sendEvent = async (type: string, data: any) => {
      const message = `data: ${JSON.stringify({ type, ...data })}\n\n`;
      await writer.write(encoder.encode(message));
    };

    (async () => {
      try {
        await sendEvent("status", {
          content: "Fetching GitHub repositories...",
        });

        // Fetch repos
        const { data: repos } = await octokit.repos.listForUser({
          username,
          per_page: 5,
          sort: "updated",
        });

        if (repos.length === 0) {
          await sendEvent("error", {
            content: `No public repos found for @${username}. Are you a ghost coder?`,
          });
          await writer.close();
          return;
        }

        await sendEvent("status", { content: "Analyzing repositories..." });

        const summaries: RepoSummary[] = [];

        // Fetch repo details
        for (const repo of repos) {
          const recentCommits: string[] = [];

          try {
            const { data: commits } = await octokit.repos.listCommits({
              owner: username,
              repo: repo.name,
              per_page: 7,
            });
            recentCommits.push(
              ...commits
                .map((c) => c.commit.message.split("\n")[0])
                .filter(Boolean)
                .slice(0, 7)
            );
          } catch (e) {}

          let packageJson = null;
          let readmeSnippet = null;

          try {
            const { data: pkg } = await octokit.repos.getContent({
              owner: username,
              repo: repo.name,
              path: "package.json",
            });
            if ("content" in pkg) {
              packageJson = JSON.parse(
                Buffer.from(pkg.content, "base64").toString()
              );
            }
          } catch (e) {}

          try {
            const { data: readme } = await octokit.repos.getContent({
              owner: username,
              repo: repo.name,
              path: "README.md",
            });
            if ("content" in readme) {
              const content = Buffer.from(readme.content, "base64").toString();
              readmeSnippet =
                content.slice(0, 200) + (content.length > 200 ? "..." : "");
            }
          } catch (e) {}

          summaries.push({
            name: repo.name,
            description: repo.description,
            language: repo.language || null,
            recentCommits:
              recentCommits.length > 0 ? recentCommits : ["No commits"],
            packageJson,
            readmeSnippet: readmeSnippet || undefined,
          });
        }

        // Format repo data
        const repoText = summaries
          .map((r, i) => {
            const deps = r.packageJson?.dependencies
              ? Object.keys(r.packageJson.dependencies).slice(0, 5).join(", ")
              : "none";
            const commits = r.recentCommits
              .map((c) => `    • "${c}"`)
              .join("\n");
            return (
              `${i + 1}. **${r.name}** (${r.language || "Unknown"})\n` +
              `   Desc: ${r.description || "No description"}\n` +
              `   Recent commits:\n${commits}\n` +
              `   Top deps: ${deps}\n` +
              `   README: "${r.readmeSnippet || "Empty"}"`
            );
          })
          .join("\n\n");

        const isRoast = mode === "roast";

        await sendEvent("status", {
          content: isRoast ? "Preparing roast..." : "Generating feedback...",
        });

        const systemPrompt = isRoast
          ? `You are a savage but funny AI comedian. Roast this GitHub user based on their repos, commit history, tech choices, and READMEs. Be witty, clever, and a bit mean — but never toxic. 4–6 punchlines. Use markdown.`
          : `You are a senior engineer mentor. Give kind, constructive feedback on their repos, code hygiene, and project structure. Highlight strengths and suggest 2–3 improvements. Be encouraging. Use markdown.`;

        const userPrompt = `User: @${username}\n\nRepos:\n${repoText}\n\n${
          isRoast ? "Roast" : "Feedback"
        }:`;

        await sendEvent("response_start", {});

        // ✅ VERCEL AI SDK - UNIFIED STREAMING FOR ALL MODELS
        const result = streamText({
          model: model, // Just change the model variable at the top!
          system: systemPrompt,
          prompt: userPrompt,
          temperature: isRoast ? 0.9 : 0.7,
          maxOutputTokens: 600,
        });

        // Stream the response
        for await (const chunk of result.textStream) {
          await sendEvent("response_chunk", { content: chunk });
        }

        await sendEvent("response_end", {});
        await writer.close();
      } catch (error: any) {
        console.error("Streaming error:", error);

        let errorMsg = "Something went wrong";
        if (error.status === 403 || error.message?.includes("rate limit")) {
          errorMsg = "GitHub rate limit exceeded. Add GITHUB_TOKEN to .env";
        } else if (error.status === 404) {
          errorMsg = "User not found on GitHub";
        } else if (error.message) {
          errorMsg = error.message;
        }

        await sendEvent("error", { content: errorMsg });
        await writer.close();
      }
    })();

    return new Response(stream.readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error: any) {
    console.error("Roast API error:", error);
    return new Response("Something went wrong", { status: 500 });
  }
}
