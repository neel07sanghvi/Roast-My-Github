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
  stars: number;
  forks: number;
  openIssues: number;
  lastPushDays: number;
  createdDays: number;
  recentCommits: Array<{
    message: string;
    additions: number;
    deletions: number;
    filesChanged: number;
    timestamp: string;
  }>;
  packageJson?: any;
  readmeSnippet?: string;
  codeAnalysis?: {
    fileName: string;
    lines: number;
    hasConsoleLog: boolean;
    hasTodos: boolean;
    longFunctions: number;
    commentRatio: number;
    snippet: string;
  };
}

// Helper to calculate days ago
function daysAgo(date: string): number {
  return Math.floor(
    (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24)
  );
}

// Analyze code quality
function analyzeCode(code: string, fileName: string) {
  const lines = code.split("\n");
  const totalLines = lines.length;

  // Count console.logs
  const hasConsoleLog = /console\.(log|warn|error|info)/gi.test(code);

  // Count TODOs
  const hasTodos = /TODO|FIXME|HACK|XXX/gi.test(code);

  // Detect long functions (basic heuristic)
  const functionMatches =
    code.match(/function\s+\w+|=>\s*{|^\s*\w+\s*\([^)]*\)\s*{/gm) || [];
  const longFunctions = functionMatches.filter(() => {
    // Simple check: functions with more than 50 lines
    return code.split("{").length > 3;
  }).length;

  // Calculate comment ratio
  const commentLines = lines.filter(
    (line) =>
      line.trim().startsWith("//") ||
      line.trim().startsWith("/*") ||
      line.trim().startsWith("*")
  ).length;
  const commentRatio = Math.round((commentLines / totalLines) * 100);

  return {
    fileName,
    lines: totalLines,
    hasConsoleLog,
    hasTodos,
    longFunctions,
    commentRatio,
    snippet: lines.slice(0, 15).join("\n"),
  };
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
        await sendEvent("status", { content: "Fetching GitHub profile..." });

        // ✅ PHASE 1: Get user profile data
        const { data: user } = await octokit.users.getByUsername({ username });

        const profileData = {
          bio: user.bio || "No bio",
          followers: user.followers,
          following: user.following,
          publicRepos: user.public_repos,
          joinedYears:
            new Date().getFullYear() - new Date(user.created_at).getFullYear(),
          location: user.location || "Unknown",
          company: user.company || "Unemployed",
        };

        await sendEvent("status", { content: "Fetching repositories..." });

        const { data: repos } = await octokit.repos.listForUser({
          username,
          per_page: 10,
          sort: "updated",
        });

        if (repos.length === 0) {
          await sendEvent("error", {
            content: `No public repos found for @${username}. Are you a ghost coder?`,
          });
          await writer.close();
          return;
        }

        await sendEvent("status", {
          content: `Analyzing repositories...`,
        });

        const summaries: RepoSummary[] = [];

        // ✅ PHASE 1 & 2: Enhanced repo analysis
        for (const repo of repos) {
          const recentCommits: RepoSummary["recentCommits"] = [];

          // Get detailed commit information
          try {
            const { data: commits } = await octokit.repos.listCommits({
              owner: username,
              repo: repo.name,
              per_page: 5,
            });

            for (const commit of commits) {
              try {
                // Get detailed commit stats
                const { data: detailedCommit } = await octokit.repos.getCommit({
                  owner: username,
                  repo: repo.name,
                  ref: commit.sha,
                });

                recentCommits.push({
                  message: commit.commit.message.split("\n")[0],
                  additions: detailedCommit.stats?.additions || 0,
                  deletions: detailedCommit.stats?.deletions || 0,
                  filesChanged: detailedCommit.files?.length || 0,
                  timestamp: commit.commit.author?.date || "",
                });
              } catch (e) {
                // If detailed commit fails, add basic info
                recentCommits.push({
                  message: commit.commit.message.split("\n")[0],
                  additions: 0,
                  deletions: 0,
                  filesChanged: 0,
                  timestamp: commit.commit.author?.date || "",
                });
              }
            }
          } catch (e) {}

          let packageJson = null;
          let readmeSnippet = null;
          let codeAnalysis = undefined;

          // Get package.json
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

          // Get README
          try {
            const { data: readme } = await octokit.repos.getContent({
              owner: username,
              repo: repo.name,
              path: "README.md",
            });
            if ("content" in readme) {
              const content = Buffer.from(readme.content, "base64").toString();
              readmeSnippet =
                content.slice(0, 300) + (content.length > 300 ? "..." : "");
            }
          } catch (e) {}

          // ✅ PHASE 2: Fetch and analyze actual code
          const codeFiles = [
            "src/index.js",
            "index.js",
            "app.js",
            "main.js",
            "src/index.ts",
            "index.ts",
            "app.ts",
            "main.ts",
            "src/App.tsx",
            "src/App.jsx",
            "App.tsx",
            "App.jsx",
            "main.py",
            "app.py",
            "__init__.py",
          ];

          for (const filePath of codeFiles) {
            try {
              const { data: file } = await octokit.repos.getContent({
                owner: username,
                repo: repo.name,
                path: filePath,
              });

              if ("content" in file) {
                const code = Buffer.from(file.content, "base64").toString();
                codeAnalysis = analyzeCode(code, filePath);
                break; // Found a file, stop searching
              }
            } catch (e) {
              continue; // Try next file
            }
          }

          summaries.push({
            name: repo.name,
            description: repo.description,
            language: repo.language || null,
            stars: repo.stargazers_count || 0,
            forks: repo.forks_count || 0,
            openIssues: repo.open_issues_count || 0,
            lastPushDays: repo.pushed_at ? daysAgo(repo.pushed_at) : 0,
            createdDays: repo.created_at ? daysAgo(repo.created_at) : 0,
            recentCommits:
              recentCommits.length > 0
                ? recentCommits
                : [
                    {
                      message: "No commits",
                      additions: 0,
                      deletions: 0,
                      filesChanged: 0,
                      timestamp: "",
                    },
                  ],
            packageJson,
            readmeSnippet: readmeSnippet || undefined,
            codeAnalysis,
          });
        }

        // ✅ Generate roasting points based on analysis
        const roastingPoints: string[] = [];

        // Profile-based roasts
        if (profileData.followers < 10) {
          roastingPoints.push(
            `Only ${profileData.followers} followers - even spam bots have standards`
          );
        }
        if (profileData.publicRepos < 5) {
          roastingPoints.push(
            "Less than 5 repos - still warming up after all these years?"
          );
        }

        // Repo-based roasts
        const noReadmeCount = summaries.filter((r) => !r.readmeSnippet).length;
        if (noReadmeCount > 2) {
          roastingPoints.push(
            `${noReadmeCount} repos without README - documentation is overrated anyway`
          );
        }

        const abandonedRepos = summaries.filter(
          (r) => r.lastPushDays > 180
        ).length;
        if (abandonedRepos > 2) {
          roastingPoints.push(
            `${abandonedRepos} abandoned repos - digital graveyard vibes`
          );
        }

        const zeroStarRepos = summaries.filter((r) => r.stars === 0).length;
        if (zeroStarRepos > 3) {
          roastingPoints.push(
            `${zeroStarRepos} repos with zero stars - not even a pity star from mom`
          );
        }

        // Commit-based roasts
        const allCommits = summaries.flatMap((r) => r.recentCommits);
        const fixCommits = allCommits.filter((c) =>
          c.message.toLowerCase().includes("fix")
        ).length;
        if (fixCommits > 5) {
          roastingPoints.push(
            `${fixCommits} commits with 'fix' - debugging by trial and error`
          );
        }

        const massiveCommits = allCommits.filter(
          (c) => c.additions > 500
        ).length;
        if (massiveCommits > 2) {
          roastingPoints.push(
            "Giant commits detected - ever heard of atomic commits?"
          );
        }

        // Code quality roasts
        const reposWithConsoleLog = summaries.filter(
          (r) => r.codeAnalysis?.hasConsoleLog
        ).length;
        if (reposWithConsoleLog > 0) {
          roastingPoints.push(
            `console.log debugging in ${reposWithConsoleLog} repos - professional level 📉`
          );
        }

        const reposWithTodos = summaries.filter(
          (r) => r.codeAnalysis?.hasTodos
        ).length;
        if (reposWithTodos > 0) {
          roastingPoints.push(
            `TODO comments everywhere - procrastination as code`
          );
        }

        const lowCommentRepos = summaries.filter(
          (r) => r.codeAnalysis && r.codeAnalysis.commentRatio < 5
        ).length;
        if (lowCommentRepos > 2) {
          roastingPoints.push(
            "Almost no comments - code so bad even you won't understand it next week"
          );
        }

        // Format detailed repo data
        const repoText = summaries
          .map((r, i) => {
            const deps = r.packageJson?.dependencies
              ? Object.keys(r.packageJson.dependencies).slice(0, 5).join(", ")
              : "none";

            const commits = r.recentCommits
              .map(
                (c) =>
                  `    • "${c.message}" (+${c.additions}/-${c.deletions}, ${
                    c.filesChanged
                  } files) ${
                    c.timestamp ? `[${daysAgo(c.timestamp)}d ago]` : ""
                  }`
              )
              .join("\n");

            const codeInfo = r.codeAnalysis
              ? `\n   Code Quality (${r.codeAnalysis.fileName}):\n` +
                `     - ${r.codeAnalysis.lines} lines\n` +
                `     - ${r.codeAnalysis.commentRatio}% comments\n` +
                `     - ${
                  r.codeAnalysis.hasConsoleLog ? "❌" : "✅"
                } console.log found\n` +
                `     - ${
                  r.codeAnalysis.hasTodos ? "❌" : "✅"
                } TODO comments\n` +
                `     - Code snippet:\n${r.codeAnalysis.snippet
                  .split("\n")
                  .map((l) => "       " + l)
                  .join("\n")}`
              : "";

            return (
              `${i + 1}. **${r.name}** (${r.language || "Unknown"})\n` +
              `   ⭐ ${r.stars} stars | 🍴 ${r.forks} forks | 🐛 ${r.openIssues} issues\n` +
              `   📅 Last push: ${r.lastPushDays} days ago | Created: ${r.createdDays} days ago\n` +
              `   Desc: ${r.description || "No description"}\n` +
              `   Recent commits:\n${commits}\n` +
              `   Top deps: ${deps}\n` +
              `   README: "${r.readmeSnippet || "Empty"}"` +
              codeInfo
            );
          })
          .join("\n\n");

        const isRoast = mode === "roast";

        await sendEvent("status", {
          content: isRoast
            ? "Preparing epic roast..."
            : "Generating feedback...",
        });

        const systemPrompt = isRoast
          ? `You are a savage but hilarious AI comedian who roasts developers. Based on the user's GitHub profile, repos, code quality, and commit history, create a BRUTALLY FUNNY roast. Use the specific roasting points provided. Be witty, creative, and merciless - but never toxic or personal. Focus on their coding habits, repo quality, and tech choices. 5-7 punchlines. Use markdown for emphasis.`
          : `You are a senior engineer mentor. Give kind, constructive feedback on their repos, code hygiene, and project structure. Highlight specific strengths from their code and suggest 2-3 concrete improvements. Be encouraging and specific. Use markdown.`;

        const userPrompt = `User: @${username}
Profile: ${profileData.bio} | ${profileData.followers} followers | ${
          profileData.following
        } following
Joined ${profileData.joinedYears} years ago | ${
          profileData.publicRepos
        } public repos | ${profileData.location} | ${profileData.company}

${
  roastingPoints.length > 0
    ? `🎯 Specific Issues Found:\n${roastingPoints
        .map((p) => `- ${p}`)
        .join("\n")}\n\n`
    : ""
}

📊 Repositories Analysis:
${repoText}

${
  isRoast
    ? "Now roast them based on these specific issues. Be savage but funny!"
    : "Provide constructive feedback based on this analysis."
}`;

        await sendEvent("response_start", {});

        // Stream AI response
        const result = streamText({
          model: model,
          system: systemPrompt,
          prompt: userPrompt,
          temperature: isRoast ? 0.9 : 0.7,
          maxOutputTokens: 800,
        });

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
