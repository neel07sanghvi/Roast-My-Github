import { NextRequest } from "next/server";
import { Octokit } from "@octokit/rest";
import { streamText } from "ai";
import { groq } from "@ai-sdk/groq";

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
  lastPushDays: number;
  createdDays: number;
  size: number;
  recentCommits: Array<{
    message: string;
    additions: number;
    deletions: number;
    filesChanged: number;
    date: string;
  }>;
  codeAnalysis?: {
    fileName: string;
    lines: number;
    hasConsoleLog: boolean;
    hasTodos: boolean;
    commentRatio: number;
    snippet: string;
    deepNesting: boolean;
    longLines: number;
    magicNumbers: number;
    singleLetterVars: number;
    hasTests: boolean;
    hasGitignore: boolean;
  };
}

function daysAgo(date: string): number {
  return Math.floor(
    (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24)
  );
}

function analyzeCode(code: string, fileName: string) {
  const lines = code.split("\n");
  const totalLines = lines.length;

  const hasConsoleLog = /console\.(log|warn|error|info)/gi.test(code);
  const hasTodos = /TODO|FIXME|HACK|XXX/gi.test(code);

  const commentLines = lines.filter(
    (line) =>
      line.trim().startsWith("//") ||
      line.trim().startsWith("/*") ||
      line.trim().startsWith("*") ||
      line.trim().startsWith("#")
  ).length;
  const commentRatio = Math.round((commentLines / totalLines) * 100);

  const deepNesting = /\{[\s\S]*?\{[\s\S]*?\{[\s\S]*?\{/.test(code);
  const longLines = lines.filter((l) => l.length > 120).length;
  const magicNumbers = (code.match(/\b\d{2,}\b/g) || []).length;
  const singleLetterVars = (code.match(/\b(let|const|var)\s+[a-z]\b/gi) || [])
    .length;

  return {
    fileName,
    lines: totalLines,
    hasConsoleLog,
    hasTodos,
    commentRatio,
    snippet: lines.slice(0, 20).join("\n"),
    deepNesting,
    longLines,
    magicNumbers,
    singleLetterVars,
  };
}

const makeWithAbort = (
  signal: AbortSignal,
  writer: WritableStreamDefaultWriter
) => {
  return async <T>(promise: Promise<T>): Promise<T> => {
    if (signal.aborted) {
      await writer.close().catch(() => {});
      throw new Error("Client aborted");
    }

    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        const onAbort = () => {
          writer.close().catch(() => {});
          reject(new Error("Client aborted"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  };
};

function buildRoastData(profileData: any, summaries: RepoSummary[]) {
  const allCommits = summaries.flatMap((r) =>
    r.recentCommits.map((c) => ({ ...c, repo: r.name }))
  );

  const worstCommits = {
    shortest: allCommits
      .filter((c) => c.message.length > 0 && c.message.length < 20)
      .sort((a, b) => a.message.length - b.message.length)
      .slice(0, 12)
      .map((c) => ({
        message: c.message,
        repo: c.repo,
        changes: `+${c.additions}/-${c.deletions}`,
        files: c.filesChanged,
      })),
    largest: allCommits
      .filter((c) => c.additions > 200)
      .sort((a, b) => b.additions - a.additions)
      .slice(0, 8)
      .map((c) => ({
        message: c.message,
        repo: c.repo,
        additions: c.additions,
        deletions: c.deletions,
        files: c.filesChanged,
      })),
    vaguest: allCommits
      .filter((c) =>
        /^(update|fix|changes?|stuff|test|wip|refactor|done|commit|edit|setup|initial|UI|ui|commit|pushed|save)$/i.test(
          c.message.trim()
        )
      )
      .slice(0, 20)
      .map((c) => ({
        message: c.message,
        repo: c.repo,
        changes: `+${c.additions}/-${c.deletions}`,
      })),
    repetitive: Object.entries(
      allCommits.reduce((acc, c) => {
        const msg = c.message.toLowerCase().trim();
        acc[msg] = (acc[msg] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    )
      .filter(([_, count]) => count >= 3)
      .sort(([_, a], [__, b]) => b - a)
      .slice(0, 5)
      .map(([msg, count]) => ({ message: msg, count })),
  };

  const reposWithCodeIssues = summaries
    .filter((r) => r.codeAnalysis)
    .map((r) => ({
      name: r.name,
      language: r.language,
      file: r.codeAnalysis!.fileName,
      stars: r.stars,
      problems: {
        consoleLogs: r.codeAnalysis!.hasConsoleLog,
        todos: r.codeAnalysis!.hasTodos,
        deepNesting: r.codeAnalysis!.deepNesting,
        noComments: r.codeAnalysis!.commentRatio < 5,
        longLines: r.codeAnalysis!.longLines,
        magicNumbers: r.codeAnalysis!.magicNumbers,
        singleLetterVars: r.codeAnalysis!.singleLetterVars,
        commentPercentage: r.codeAnalysis!.commentRatio,
      },
      codeSnippet: r.codeAnalysis!.snippet,
      topCommits: r.recentCommits.slice(0, 5).map((c) => ({
        message: c.message,
        changes: `+${c.additions}/-${c.deletions}`,
      })),
    }))
    .filter(
      (r) =>
        r.problems.consoleLogs ||
        r.problems.todos ||
        r.problems.deepNesting ||
        r.problems.noComments ||
        r.problems.longLines > 10 ||
        r.problems.magicNumbers > 5 ||
        r.problems.singleLetterVars > 3
    )
    .slice(0, 15);

  const embarrassingRepos = summaries
    .filter(
      (r) =>
        !r.description || r.lastPushDays > 180 || r.stars === 0 || r.size < 10
    )
    .map((r) => ({
      name: r.name,
      issue: !r.description
        ? "No description - not even trying to explain this mess"
        : r.lastPushDays > 730
        ? `Abandoned ${Math.round(r.lastPushDays / 365)} years ago`
        : r.lastPushDays > 365
        ? "Ghosted over a year ago"
        : r.stars === 0
        ? "Zero stars - even you don't star your own work"
        : "Repo smaller than a hello world project",
      language: r.language,
      daysSinceTouch: r.lastPushDays,
      stars: r.stars,
      size: r.size,
    }))
    .sort((a, b) => b.daysSinceTouch - a.daysSinceTouch)
    .slice(0, 15);

  return {
    developer: {
      username: profileData.username,
      accountAge: profileData.joinedYears,
      bio: profileData.bio,
      company: profileData.company,
      location: profileData.location,
      followers: profileData.followers,
      totalRepos: profileData.publicRepos,
    },
    commitCrimes: worstCommits,
    codeHorrors: reposWithCodeIssues,
    abandonedProjects: embarrassingRepos,
    stats: {
      totalReposAnalyzed: summaries.length,
      totalCommitsFound: allCommits.length,
      abandonedCount: summaries.filter((r) => r.lastPushDays > 180).length,
      activeCount: summaries.filter((r) => r.lastPushDays < 30).length,
      totalStars: summaries.reduce((sum, r) => sum + r.stars, 0),
      avgCommitSize: Math.round(
        allCommits.reduce((sum, c) => sum + c.additions, 0) /
          Math.max(allCommits.length, 1)
      ),
      zeroStarRepos: summaries.filter((r) => r.stars === 0).length,
    },
  };
}

export async function POST(req: NextRequest) {
  const { signal } = req;

  if (signal.aborted) return new Response(null, { status: 499 });

  try {
    let { username, mode } = await req.json();

    if (!username) {
      return new Response("Username required", { status: 400 });
    }

    username = username.trim();

    if (username.includes('github.com/')) {
      username = username.split('github.com/')[1].split('/')[0];
    }

    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    const sendEvent = async (type: string, data: any) => {
      if (signal.aborted) {
        await writer.close().catch(() => {});
        throw new Error("Client aborted");
      }

      const message = `data: ${JSON.stringify({ type, ...data })}\n\n`;
      await writer.write(encoder.encode(message));
    };

    signal.addEventListener("abort", () => {
      writer.close().catch(() => {});
    });

    const withAbort = makeWithAbort(signal, writer);

    (async () => {
      try {
        await sendEvent("status", {
          content: "🔍 Investigating GitHub profile...",
        });

        const { data: user } = await withAbort(
          octokit.users.getByUsername({ username })
        );

        const profileData = {
          username,
          bio: user.bio || "No bio",
          company: user.company || "Unemployed",
          location: user.location || "Unknown",
          followers: user.followers,
          following: user.following,
          publicRepos: user.public_repos,
          joinedYears:
            new Date().getFullYear() - new Date(user.created_at).getFullYear(),
        };

        await sendEvent("status", {
          content: `📚 Fetching ALL ${profileData.publicRepos} repositories...`,
        });

        const { data: repos } = await withAbort(
          octokit.repos.listForUser({
            username,
            per_page: profileData.publicRepos,
            sort: "updated",
          })
        );

        if (repos.length === 0) {
          await sendEvent("error", {
            content: `No public repos found for @${username}.`,
          });
          await writer.close();
          return;
        }

        await sendEvent("status", {
          content: `⚡ Deep-diving into repos (this might take a moment)...`,
        });

        const summaries: RepoSummary[] = await Promise.all(
          repos.map(async (repo) => {
            const [commits, codeAnalysis, hasTests, hasGitignore] =
              await Promise.all([
                (async () => {
                  try {
                    const { data: commits } = await withAbort(
                      octokit.repos.listCommits({
                        owner: username,
                        repo: repo.name,
                        per_page: 30,
                      })
                    );

                    const detailedCommits = await Promise.all(
                      commits.slice(0, 15).map(async (commit) => {
                        try {
                          const { data: detailedCommit } = await withAbort(
                            octokit.repos.getCommit({
                              owner: username,
                              repo: repo.name,
                              ref: commit.sha,
                            })
                          );

                          return {
                            message: commit.commit.message.split("\n")[0],
                            additions: detailedCommit.stats?.additions || 0,
                            deletions: detailedCommit.stats?.deletions || 0,
                            filesChanged: detailedCommit.files?.length || 0,
                            date: commit.commit.author?.date || "",
                          };
                        } catch (e) {
                          return {
                            message: commit.commit.message.split("\n")[0],
                            additions: 0,
                            deletions: 0,
                            filesChanged: 0,
                            date: commit.commit.author?.date || "",
                          };
                        }
                      })
                    );

                    return detailedCommits;
                  } catch (e) {
                    return [];
                  }
                })(),

                (async () => {
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
                    "server.js",
                    "src/server.js",
                    "src/app.py",
                    "main.py",
                    "app.py",
                    "__init__.py",
                  ];

                  for (const filePath of codeFiles) {
                    if (signal.aborted) break;

                    try {
                      const { data: file } = await withAbort(
                        octokit.repos.getContent({
                          owner: username,
                          repo: repo.name,
                          path: filePath,
                        })
                      );

                      if (
                        "content" in file &&
                        typeof file.content === "string"
                      ) {
                        const code = atob(file.content);
                        return analyzeCode(code, filePath);
                      }
                    } catch (e) {
                      continue;
                    }
                  }
                  return undefined;
                })(),

                // Check for tests
                (async () => {
                  const testPaths = [
                    "test",
                    "tests",
                    "__tests__",
                    "spec",
                    "src/test",
                  ];
                  for (const path of testPaths) {
                    try {
                      await withAbort(
                        octokit.repos.getContent({
                          owner: username,
                          repo: repo.name,
                          path,
                        })
                      );
                      return true;
                    } catch (e) {
                      continue;
                    }
                  }
                  return false;
                })(),

                // Check for .gitignore
                (async () => {
                  try {
                    await withAbort(
                      octokit.repos.getContent({
                        owner: username,
                        repo: repo.name,
                        path: ".gitignore",
                      })
                    );
                    return true;
                  } catch (e) {
                    return false;
                  }
                })(),
              ]);

            return {
              name: repo.name,
              description: repo.description,
              language: repo.language || null,
              stars: repo.stargazers_count,
              forks: repo.forks_count,
              lastPushDays: repo.pushed_at ? daysAgo(repo.pushed_at) : 0,
              createdDays: repo.created_at ? daysAgo(repo.created_at) : 0,
              size: repo.size,
              recentCommits: commits,
              codeAnalysis: codeAnalysis
                ? { ...codeAnalysis, hasTests, hasGitignore }
                : undefined,
            } as RepoSummary;
          })
        );

        const roastData = buildRoastData(profileData, summaries);

        const isRoast = mode === "roast";

        await sendEvent("status", {
          content: isRoast
            ? "🔥 Preparing NUCLEAR roast..."
            : "💡 Crafting professional feedback...",
        });

        const roastPrompt = `You are a LEGENDARY roast comedian performing at a sold-out tech conference. Your victim: @${
          profileData.username
        }

🎯 ROASTING RULES - FOLLOW EXACTLY:

1. **STRUCTURE YOUR ROAST LIKE A COMEDY SET:**
   - Opening Hook (20 sec): Savage intro using their bio "${
     profileData.bio
   }" and company "${profileData.company}"
   - Act 1 - Commit Crimes (90 sec): Roast 8-12 specific commits
   - Act 2 - Code Horrors (90 sec): Show 4-6 actual code snippets
   - Act 3 - Abandoned Projects (60 sec): Mock their dead repos
   - Grand Finale (20 sec): Devastating callback

2. **BE HYPER-SPECIFIC - USE EXACT DATA:**
   ${JSON.stringify(roastData, null, 2)}

3. **COMEDY REQUIREMENTS:**
   ✅ Quote EXACT commit messages with repo names
   ✅ Show ACTUAL code in code blocks (\`\`\`language\n...\n\`\`\`)
   ✅ Use 25+ emojis (🔥💀😂😭🤡💩🎪🚨⚰️👻🤯🙄🤦‍♂️)
   ✅ Build to bigger laughs (start good, end DEVASTATING)
   ✅ Use rhetorical questions ("Did you really commit 'fix' 8 times?")
   ✅ Make callbacks to earlier jokes

4. **FORMATTING:**
   - Use **bold** for commit messages
   - Use \`inline code\` for function names
   - Use code blocks for showing their code
   - Use emojis after punchlines
   - Break into short paragraphs

5. **EXAMPLE OPENING:**
"@${profileData.username}, your bio says '${
          profileData.bio
        }' 💀 and you work at '${profileData.company}' 🤡. ${
          profileData.followers
        } followers in ${
          profileData.joinedYears
        } years? I've seen abandoned repos with better engagement! 📉"

6. **WHEN SHOWING CODE, FORMAT LIKE:**
"In '${roastData.codeHorrors[0]?.name}', I found this masterpiece:
\`\`\`${roastData.codeHorrors[0]?.language?.toLowerCase() || "javascript"}
${roastData.codeHorrors[0]?.codeSnippet.split("\n").slice(0, 10).join("\n")}
\`\`\`
Zero comments, console.logs everywhere, and functions named 'doStuff'? 🤡 This isn't code, it's a cry for help! 😭"

🔥 NOW ROAST THEM BRUTALLY! THIS IS YOUR COMEDY SPECIAL!`;

        const feedbackPrompt = `You are a world-class senior engineer and technical mentor reviewing @${
          profileData.username
        }'s GitHub profile.

📊 DEVELOPER PROFILE & ANALYSIS:
${JSON.stringify(roastData, null, 2)}

🎯 YOUR MISSION - CREATE A COMPREHENSIVE TECHNICAL REVIEW:

**STRUCTURE YOUR REVIEW:**

1. **Executive Summary** (30 sec read)
   - Quick snapshot of their technical profile
   - Overall skill assessment
   - Key strengths highlighted

2. **Strengths & Achievements** (60 sec)
   - Highlight specific repos with actual impact
   - Point out good practices you found
   - Recognize technical skills demonstrated
   - Show ACTUAL good code examples if found

3. **Areas for Improvement** (90 sec)
   - **Code Quality Issues**: Show SPECIFIC problems with code blocks
   - **Commit Hygiene**: Reference exact vague commits
   - **Project Management**: Discuss abandoned repos by name
   - **Best Practices**: Missing tests, docs, etc.

4. **Actionable Recommendations** (60 sec)
   - 5-7 concrete, specific actions they can take TODAY
   - Prioritize by impact (quick wins first)
   - Include resources/links where helpful

5. **Encouragement & Next Steps** (30 sec)
   - Positive, motivating conclusion
   - Acknowledge growth trajectory
   - Invite further questions

📝 FORMATTING REQUIREMENTS:
✅ Use ## for section headers
✅ Use \`\`\`language for code examples
✅ Use **bold** for emphasis on key points
✅ Use bullet points for lists
✅ Use \`inline code\` for file/function names
✅ Include emojis strategically (✅ ❌ 💡 🎯 📊 🚀 ⚠️)
✅ Keep tone professional but approachable

🎨 EXAMPLE CODE REVIEW FORMAT:
"In \`${roastData.codeHorrors[0]?.name}/${
          roastData.codeHorrors[0]?.file
        }\`, I noticed:

\`\`\`${roastData.codeHorrors[0]?.language?.toLowerCase() || "javascript"}
${roastData.codeHorrors[0]?.codeSnippet.split("\n").slice(0, 8).join("\n")}
\`\`\`

⚠️ **Issues Found:**
- ${
          roastData.codeHorrors[0]?.problems.consoleLogs
            ? "Debug console.logs left in production code"
            : ""
        }
- ${
          roastData.codeHorrors[0]?.problems.noComments
            ? "No comments explaining complex logic"
            : ""
        }
- ${
          roastData.codeHorrors[0]?.problems.singleLetterVars
            ? "Single-letter variables reducing readability"
            : ""
        }

💡 **Recommendation:**
Add JSDoc comments, remove debug statements, use descriptive variable names."

🎯 BE SPECIFIC, ACTIONABLE, AND ENCOURAGING!`;

        await sendEvent("response_start", {});

        const result = streamText({
          model: model,
          system: isRoast
            ? "You are a savage but hilarious tech comedian. Follow the structure exactly."
            : "You are a senior technical mentor providing detailed, actionable feedback.",
          prompt: isRoast ? roastPrompt : feedbackPrompt,
          temperature: isRoast ? 1.1 : 0.7,
          maxOutputTokens: 3000,
          abortSignal: signal,
        });

        for await (const chunk of result.textStream) {
          await sendEvent("response_chunk", { content: chunk });
        }

        await sendEvent("response_end", {});
        await writer.close();
      } catch (error: any) {
        if (error.message === "Client aborted") {
          console.log("Request aborted by client");
          return;
        }

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
