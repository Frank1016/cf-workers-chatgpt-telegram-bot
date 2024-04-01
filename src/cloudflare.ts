import { OpenAI } from "./openai";


export namespace Cloudflare {
    // Utility function to handle JSON stringification with specific replacements
    function jsonStringifyWithReplacements(obj: any): string {
        return JSON.stringify(obj).replaceAll("\\n", "");
    }

    /**
     * Retrieves the chat context for a given chat ID from Cloudflare KV storage.
     * @param kv The KVNamespace instance.
     * @param chat_id The chat ID.
     * @returns A promise that resolves to an array of OpenAI.Message objects.
     */
    export async function getKVChatContext(kv: KVNamespace, chat_id: string): Promise<OpenAI.Message[]> {
        try {
            // Attempt to retrieve and parse the chat context from KV storage.
            const result = await kv.get<OpenAI.Message[]>(chat_id, { type: "json" });
            // Return the result if it exists, or an empty array (with an explicit type assertion) if not.
            return result || [] as OpenAI.Message[];
        } catch (error) {
            console.error(`Error getting KV chat context for chat_id=${chat_id}:`, error);
            // Depending on your error handling strategy, you might want to re-throw, handle, or log the error.
            throw error;
        }
    }
    

    /**
     * Updates the chat context for a given chat ID in Cloudflare KV storage.
     * @param kv The KVNamespace instance.
     * @param chat_id The chat ID.
     * @param context The new chat context to store.
     */
    export async function putKVChatContext(kv: KVNamespace, chat_id: string, context: OpenAI.Message[]) {
        try {
            const jsonString = jsonStringifyWithReplacements(context);
            await kv.put(chat_id, jsonString);
        } catch (error) {
            console.error(`Error updating KV chat context for chat_id=${chat_id}:`, error);
            // Depending on your error handling strategy, you might want to re-throw, handle, or log the error.
            throw error;
        }
    }
}
