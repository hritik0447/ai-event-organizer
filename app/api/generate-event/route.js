import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateWithRetry(systemPrompt, maxAttempts = 4) {
  const models = [
    "gemini-3.5-flash-lite",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
  ];

  let lastError;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const model = models[attempt % models.length];
    try {
      const result = await ai.models.generateContent({
        model,
        contents: systemPrompt,
      });
      return result.text;
    } catch (error) {
      lastError = error;
      const isOverloaded =
        error?.status === 503 ||
        error?.message?.includes("UNAVAILABLE") ||
        error?.message?.includes("high demand");

      if (!isOverloaded || attempt === maxAttempts - 1) {
        throw error;
      }

      // Wait a bit longer each retry (1s, 2s, 3s...) before trying again
      await sleep(1000 * (attempt + 1));
    }
  }

  throw lastError;
}

export async function POST(req) {
  try {
    const { prompt } = await req.json();

    if (!prompt) {
      return NextResponse.json(
        { error: "Prompt is required" },
        { status: 400 }
      );
    }

    const systemPrompt = `You are an event planning assistant. Generate event details based on the user's description.

CRITICAL: Return ONLY valid JSON with properly escaped strings. No newlines in string values - use spaces instead.

Return this exact JSON structure:
{
  "title": "Event title (catchy and professional, single line)",
  "description": "Detailed event description in a single paragraph. Use spaces instead of line breaks. Make it 2-3 sentences describing what attendees will learn and experience.",
  "category": "One of: tech, music, sports, art, food, business, health, education, gaming, networking, outdoor, community",
  "suggestedCapacity": 50,
  "suggestedTicketType": "free"
}

User's event idea: ${prompt}

Rules:
- Return ONLY the JSON object, no markdown, no explanation
- All string values must be on a single line with no line breaks
- Use spaces instead of \\n or line breaks in description
- Make title catchy and under 80 characters
- Description should be 2-3 sentences, informative, single paragraph
- suggestedTicketType should be either "free" or "paid"
`;

    const text = await generateWithRetry(systemPrompt);

    // Clean the response (remove markdown code blocks if present)
    let cleanedText = text.trim();
    if (cleanedText.startsWith("```json")) {
      cleanedText = cleanedText
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "");
    } else if (cleanedText.startsWith("```")) {
      cleanedText = cleanedText.replace(/```\n?/g, "");
    }

    const eventData = JSON.parse(cleanedText);

    return NextResponse.json(eventData);
  } catch (error) {
    console.error("Error generating event:", error);
    return NextResponse.json(
      {
        error:
          "The AI service is currently busy. Please try again in a moment, or fill in the event details manually.",
      },
      { status: 503 }
    );
  }
}