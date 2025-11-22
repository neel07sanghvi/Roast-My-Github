# 🔥 AI GitHub Roast

Get your GitHub profile brutally roasted or professionally reviewed by AI.
Try it - https://roast-my-github-pi.vercel.app/

## 🚀 Quick Start

1. **Clone & Install**
```bash
git clone <your-repo-url>
cd ai-github-roast
npm install
```

2. **Setup Environment**
```bash
cp .env.example .env.local
```

Add your API keys to `.env.local`:
- **Required:** `GITHUB_TOKEN` - [Get it here](https://github.com/settings/tokens) (no special permissions needed)
- **Required:** Pick ONE AI provider:
  - `GROQ_API_KEY` - [Free & Fast](https://console.groq.com) ⚡ (Recommended)
  - `GOOGLE_GENERATIVE_AI_API_KEY` - [Free](https://makersuite.google.com/app/apikey)
  - `OPENAI_API_KEY` - [Paid](https://platform.openai.com/api-keys)
  - `ANTHROPIC_API_KEY` - [Paid](https://console.anthropic.com)

3. **Run**
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## 🎯 Features

- 🔥 **Roast Mode** - Savage comedy roast of your repos
- 💡 **Feedback Mode** - Professional code review & suggestions
- ⚡ **Real-time Streaming** - See results as they generate
- 📊 **Deep Analysis** - Analyzes commits, code quality, and repo health

## 🛠️ Tech Stack

Next.js 15 • TypeScript • Tailwind CSS • shadcn/ui • Vercel AI SDK

## 📝 License

MIT
