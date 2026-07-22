import express, { Request, Response as ExpressResponse } from "express";
import { MongoClient, ServerApiVersion, Db, Collection } from "mongodb";
import cors from "cors";
import dotenv from "dotenv";
import Groq from "groq-sdk";
// Load environment variables
dotenv.config();

const app = express();
const groq = new Groq();
// Middleware
app.use(cors());
app.use(express.json());

// ─── Database Connection Setup ───
const uri = process.env.MONGODB_URI as string;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let db: Db;
let designsCollection: Collection;
let galleryCollection: Collection;

async function connectDB() {
  try {
    await client.connect();
    console.log("Connected to MongoDB");
    db = client.db("nusrat-mehedi-design");
    designsCollection = db.collection("designs");
    galleryCollection = db.collection("gallery");
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
    process.exit(1); // Exit process if DB connection fails
  }
}

// Connect to MongoDB when the server starts
connectDB();

// ─── Helper Functions ───
// Retry requests if Grok throws temporary 502/503/504 gateway errors
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 2,
  delay = 1000
): Promise<globalThis.Response> {
  for (let i = 0; i < retries; i++) {
    const response = await fetch(url, options);
    // If successful or non-transient error, return response
    if (response.ok || ![502, 503, 504].includes(response.status)) {
      return response;
    }
    // Wait before retrying (exponential backoff)
    await new Promise((resolve) => setTimeout(resolve, delay * (i + 1)));
  }
  return fetch(url, options);
}

// ─── Express Routes ───

// Health check
app.get("/", (req: Request, res: ExpressResponse) => {
  res.json({ message: "MehendiHub API Server Running", status: "ok" });
});

// GET /api/designs
// Query params: search, category, minRating, sort, page, limit
app.get("/api/designs", async (req: Request, res: ExpressResponse) => {
  try {
    const {
      search = "",
      category = "",
      minRating,
      sort = "rating",
      page = "1",
      limit = "6",
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.max(1, Math.min(50, parseInt(limit as string, 10)));

    // Build MongoDB filter
    const filter: Record<string, any> = {};

    if (search) {
      filter.$or = [
        { artist: { $regex: search, $options: "i" } },
        { title: { $regex: search, $options: "i" } },
      ];
    }

    if (category) {
      filter.tags = { $in: [category] };
    }

    if (minRating) {
      filter.rating = { $gte: parseFloat(minRating as string) };
    }

    // Sort options
    let sortObj: Record<string, 1 | -1> = { rating: -1 };
    if (sort === "name") sortObj = { artist: 1 };
    else if (sort === "newest") sortObj = { createdAt: -1 };
    else if (sort === "rating") sortObj = { rating: -1 };

    const total = await designsCollection.countDocuments(filter);
    const designs = await designsCollection
      .find(filter)
      .sort(sortObj)
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .toArray();

    res.json({
      data: designs,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    console.error("Error fetching designs:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/designs/:id
app.get("/api/designs/:id", async (req: Request, res: ExpressResponse) => {
  try {
    const { id } = req.params;
    const design = await designsCollection.findOne({ id });
    if (!design) return res.status(404).json({ error: "Design not found" });
    res.json(design);
  } catch (err) {
    console.error("Error fetching design:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/gallery
// Query params: category, page, limit
app.get("/api/gallery", async (req: Request, res: ExpressResponse) => {
  try {
    const { category = "", page = "1", limit = "6" } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.max(1, Math.min(50, parseInt(limit as string, 10)));

    const filter: Record<string, any> = {};
    if (category && category !== "All") {
      filter.category = category;
    }

    const total = await galleryCollection.countDocuments(filter);
    const items = await galleryCollection
      .find(filter)
      .sort({ completedAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .toArray();

    res.json({
      data: items,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    console.error("Error fetching gallery:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/chat
app.post("/api/chat", async (req: Request, res: ExpressResponse) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Invalid messages array" });
    }

    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ error: "GROQ_API_KEY is missing from environment variables" });
    }

    const systemPrompt = `You are Nusrat AI Assistant, an expert mehendi booking assistant for the MehendiHub platform.
Your goal is to help users find the perfect mehendi design, answer questions about artists, and guide them on how to book.

Platform Context:
- Nusrat Jahan is the owner and  professional artist
- Styles available: Bridal, Arabic, Minimalist, Moroccan, Party Henna, etc.
- Booking process: Users can browse the 'Explore' page, select a designer, and click 'Book Now' to view their specific availability.
- Recent works are showcased in the Gallery.
- Top rated designs include: 'Royal Bridal Peacock Mesh', 'Intricate Arabic Wrist & Palm', 'Indo-Arabic Fusion Bridal'.

Instructions:
1. Be warm, welcoming, and culturally appreciative.
2. Provide personalized design recommendations based on user preferences.
3. Guide users on how to book a session.
4. Always respond in the language the user speaks to you.

If you recommend a booking based on the user's specific request, you MUST include a booking preview block at the end of your message exactly in this JSON-like markdown format:
\`\`\`booking-preview
{
  "service": "Name of Service",
  "date": "Suggested Date (e.g., Oct 24, 2024)",
  "artist": "Artist Name"
}
\`\`\`
Keep your responses concise and helpful.`;

   // Explicitly type groqMessages array and assert role string literal types
    const groqMessages: Groq.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...messages.map((m: any) => ({
        role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
        content: m.content,
      })),
    ];

    // Call Groq API with Llama 3
    const chatCompletion = await groq.chat.completions.create({
      messages: groqMessages,
      model: "llama-3.3-70b-versatile",
      temperature: 0.7,
      max_tokens: 1024,
    });

    const reply = chatCompletion.choices[0]?.message?.content || "";
    res.json({ reply });
  } catch (err: any) {
    console.error("Groq API Error:", err);
    res.status(500).json({
      error: err?.message || "Error communicating with Groq AI service",
    });
  }
});
// ─── Start Server ───
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});