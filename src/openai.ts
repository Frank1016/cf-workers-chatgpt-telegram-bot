export namespace OpenAI {
    let BASE_URL = "https://api.openai.com/v1";
    const IMAGE_GENERATION_SIZE = "512x512";
    const REQUEST_TIMEOUT_MS = 10000; // 10 seconds

    interface ErrorResponse {
        message: string;
    }

    interface ChatCompletionResponse {
        id: string;
        object: string;
        created: number;
        model: string;
        usage: Usage;
        choices: Choice[];
        error?: ErrorResponse; // Handle potential errors directly
    }

    interface ImageGenerationResponse<T> {
        id: string;
        object: string;
        created: number;
        model: string;
        usage: Usage;
        data?: T;
        error?: ErrorResponse;
    }

    interface Choice {
        message: Message;
        finish_reason: string;
        index: number;
    }

    export interface Message {
        role: string;
        content: string;
    }

    interface Usage {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    }

    async function makeApiRequest<T>(endpoint: string, method: "POST" | "GET", apiKey: string, body?: any): Promise<T> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const response = await fetch(`${BASE_URL}${endpoint}`, {
                method,
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`,
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });

            clearTimeout(timeout);
            if (!response.ok) {
                const error: ErrorResponse = await response.json();
                throw new Error(`API error: ${error.message}`);
            }

            return response.json();
        } catch (error) {
            console.error("API call error:", error);
            throw error; // Rethrow for custom handling by caller
        }
    }

    export async function complete(api_key: string, model: string, system: string, user: string, context: Message[]): Promise<string> {
        if (system.trim() !== "") {
            context.unshift({ role: "system", content: system });
        }

        const userHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(user))))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");

        const endpoint = "/chat/completions";
        const method = "POST";
        const body = {
            model: model,
            user: userHash,
            messages: context,
        };

        try {
            const jsonResponse: ChatCompletionResponse = await makeApiRequest<ChatCompletionResponse>(endpoint, method, api_key, body);
            if (jsonResponse.choices && jsonResponse.choices.length > 0) {
                return jsonResponse.choices[0].message.content.trim();
            } else {
                console.error("Empty or invalid response from API.");
                return "An error occurred while processing your request. Please try again later.";
            }
        } catch (error) {
            console.error("Error calling OpenAI API:", error);
            return "An error occurred while processing your request. Please try again later.";
        }
    }


    export async function createImage(api_key: string, model: string, prompt: string): Promise<string> {
        const jsonResponse: ImageGenerationResponse<{ url: string }[]> = await makeApiRequest("/images/generations", "POST", api_key, {
            prompt,
            model: model,
            size: IMAGE_GENERATION_SIZE,
            n: 1,
        });

        return jsonResponse.data?.[0].url ?? "No image URL";
    }

}

