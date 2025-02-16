# SoferAI YUTorah Transcriber Extension

This Chrome extension adds a "Get Transcript" button to YUTorah lectures.

## Setup

1. Install the extension in Chrome
2. Sign in to your SoferAI account at https://app.sofer.ai
3. Visit any YUTorah lecture page to see the transcript button

## Next.js API Route Setup

Add the following route handler in your Next.js app at `app/api/transcribe/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { transcribeAudio } from '@/app/actions/transcription';

export async function POST(request: Request) {
    try {
        const { sessionId, formData } = await request.json();
        
        if (!sessionId || !formData) {
            return NextResponse.json(
                { success: false, error: 'Missing required fields' },
                { status: 400 }
            );
        }

        const result = await transcribeAudio(sessionId, formData);
        
        return NextResponse.json(result);
    } catch (error) {
        console.error('Transcription error:', error);
        return NextResponse.json(
            { 
                success: false, 
                error: error instanceof Error ? error.message : 'Transcription failed' 
            },
            { status: 500 }
        );
    }
}
```

This route will:
1. Receive the transcription request from the extension
2. Call your existing server action
3. Return the result to the extension

## Development

1. Clone the repository
2. Run `npm install`
3. Run `npm run build` to build the extension
4. Load the `build` directory as an unpacked extension in Chrome

```bash
pnpm install
```

## Build

```bash
pnpm build
```
