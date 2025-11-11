import { NextRequest, NextResponse } from "next/server";
import { Octokit } from "@octokit/rest";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const octokit = new Octokit(); // unauthenticated = 60 req/hour

interface RepoSummary {
  name: string;
  description: string | null;
  language: string | null;
  lastCommit: string;
  packageJson?: any;
  readmeSnippet?: string;
}

export async function POST(req: NextRequest) {
  try {
    const { username, mode } = await req.json();
    if (!username)
      return NextResponse.json({ error: "Username required" }, { status: 400 });

    // 1. Get user + public repos
    const { data: repos } = await octokit.repos.listForUser({
      username,
      per_page: 100,
      sort: "updated",
    });

    if (repos.length === 0) {
      return NextResponse.json({
        roast: `No public repos found for @${username}. Are you a ghost coder?`,
      });
    }

    // 2. Pick top 5 recent repos
    const selectedRepos = repos.slice(0, 5);
    const summaries: RepoSummary[] = [];

    for (const repo of selectedRepos) {
      let packageJson = null;
      let readmeSnippet = null;
      let lastCommit = "No commits";

      try {
        const { data: commits } = await octokit.repos.listCommits({
          owner: username,
          repo: repo.name,
          per_page: 1,
        });
        lastCommit = commits[0]?.commit.message.split("\n")[0] || "No message";
      } catch (e) {}

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
        lastCommit,
        packageJson,
        readmeSnippet: readmeSnippet || undefined,
      });
    }

    // 3. Build prompt
    const repoText = summaries
      .map((r, i) => {
        const deps = r.packageJson?.dependencies
          ? Object.keys(r.packageJson.dependencies).slice(0, 5).join(", ")
          : "none";
        return (
          `${i + 1}. **${r.name}** (${r.language || "Unknown"})\n` +
          `   Desc: ${r.description || "No description"}\n` +
          `   Last commit: "${r.lastCommit}"\n` +
          `   Top deps: ${deps}\n` +
          `   README: "${r.readmeSnippet || "Empty"}"`
        );
      })
      .join("\n\n");

    const isRoast = mode === "roast";

    const systemPrompt = isRoast
      ? `You are a savage but funny AI comedian. Roast this GitHub user based on their repos. Be clever, witty, and a little mean — but not toxic. 4–6 punchlines. Use markdown.`
      : `You are a senior engineer mentor. Give kind, constructive feedback on their repos. Highlight strengths and suggest 2–3 improvements. Be encouraging. Use markdown.`;

    const userPrompt = `User: @${username}\n\nRepos:\n${repoText}\n\n${
      isRoast ? "Roast" : "Feedback"
    }:`;

    // 4. Call OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: isRoast ? 0.9 : 0.7,
      max_tokens: 500,
    });

    const roast =
      completion.choices[0]?.message?.content?.trim() || "AI had no words...";

    return NextResponse.json({ roast });
  } catch (error: any) {
    console.error("Roast API error:", error);
    if (error.status === 404) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (error.status === 403) {
      return NextResponse.json(
        { error: "GitHub rate limit hit. Try again in 1 min." },
        { status: 429 }
      );
    }
    return NextResponse.json(
      { error: "Something went wrong. Try again!" },
      { status: 500 }
    );
  }
}
