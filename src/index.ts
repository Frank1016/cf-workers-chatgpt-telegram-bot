
import { Cloudflare } from "./cloudflare"
import { OpenAI } from "./openai"
import { Telegram } from "./telegram"

export interface Env {
	CHATGPT_TELEGRAM_BOT_KV: KVNamespace
	TELEGRAM_BOT_TOKEN: string
	TELEGRAM_USERNAME_WHITELIST: string
	OPENAI_API_KEY: string
	CHATGPT_MODEL: string
	IMAGE_MODEL: string
	CHATGPT_BEHAVIOR: string
	CONTEXT: number
}

interface CfProperties {
	asOrganization?: string;
	// Include other properties of the cf object you need
}


export default {
	async fetch(
		request: Request & { cf?: CfProperties }, // Asserting the type of request here
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		// Security check: Verify the request is authorized
		if (!request.cf?.asOrganization?.toLowerCase().includes("telegram") || !request.url.endsWith(env.TELEGRAM_BOT_TOKEN)) {
			return new Response(null, {
				status: 401,
			})
		}

		let update: Telegram.Update;
		try {
			update = await request.json();
		} catch (error) {
			console.error('Error parsing request JSON:', error);
			return new Response('Invalid request body', { status: 400 });
		}

		// Whitelist check
		const username = update.message?.from.username || update.inline_query?.from.username || update.callback_query?.from.username || "";
		// if (env.TELEGRAM_USERNAME_WHITELIST.split(" ").map(name => name.toLowerCase()).indexOf(username.toLowerCase()) === -1) {
		// 	return new Response(null, { status: 403, statusText: 'Forbidden' });
		// }

		// Inline query handling
		if (update.inline_query) {
			// Handling empty query
			if (update.inline_query.query.trim() === "") {
				return Telegram.generateAnswerInlineQueryResponseEmpty(update.inline_query.id);
			}
			// Handling non-empty query
			return Telegram.generateAnswerInlineQueryResponse(update.inline_query.id, update.inline_query.query);
		}

		// Early return for non-message and non-callback query updates
		if ((!update.message || !update.message.text) && (!update.callback_query)) {
			return new Response(null, { status: 400, statusText: 'Bad Request' });
		}

		const chatID = update.message?.chat.id || update.callback_query?.chat_instance || null;
		if (chatID == null) {
			return new Response(null, { status: 400, statusText: 'Bad Request' });
		}

		const query = update.message?.text || update.callback_query?.data;
		if (!query) {
			return new Response(null, { status: 400, statusText: 'Bad Request' });
		}

		// Temporary processing message for callback queries
		if (update.callback_query) {
			await Telegram.sendEditInlineMessageText(env.TELEGRAM_BOT_TOKEN, update.callback_query.inline_message_id, `Query: ${query}\n\n(Processing...)`);
		}

		// Context initialization for message handling
		let context: OpenAI.Message[] = [];

		// retrieve current context
		if (env.CONTEXT && env.CONTEXT > 0 && env.CHATGPT_TELEGRAM_BOT_KV) {
			context = await Cloudflare.getKVChatContext(env.CHATGPT_TELEGRAM_BOT_KV, chatID)
		}

		// Command handling: Start, Help, etc.
		if (update.message && update.message.text) {


			if (query.startsWith("/start") || query.startsWith("/help")) {
				const username = update.message?.from?.username || "user";
				return Telegram.generateSendMessageResponse(chatID, `Hi ${username}! I'm an AI bot developed by $GROK | NEAR! Use /image command with your image request in both private and group chats to create images. For text replies, use /chat command in group chats, but it's not necessary in private chats.`,
					{
						"reply_markup": { "remove_keyboard": true }
					}
				)
			} else if (query.startsWith("/buy")) {
				return Telegram.generateSendMessageResponse(chatID, "To buy $GROK, visit https://app.ref.finance/swap/#near|grokcoin.near, connect your NEAR wallet, and add the coin manually by typing grokcoin.near since it's not yet on the whitelist, but it will be soon.",
					{

						"reply_markup": { "remove_keyboard": true }
					}
				)
			}



			// add replied to message to context (excluding command replies) if it exists
			if (update.message.reply_to_message) {
				if (!update.message.reply_to_message.text.startsWith("COMMAND:")) {
					context.push({ "role": (update.message.reply_to_message.from.is_bot ? "assistant" : "user"), "content": update.message.reply_to_message.text })
				}
			}
		}


		// handle private chat messages
		if (update.message?.chat.type === "private") {
			if (query.startsWith("/image")) {
				try {
					const imagePrompt = query.substring("/image".length).trim();
					const imageUrl = await OpenAI.createImage(env.OPENAI_API_KEY, env.IMAGE_MODEL, imagePrompt);

					return Telegram.generateSendPhotoResponse(
						update.message.chat.id,
						imageUrl,
						{ reply_to_message_id: update.message.message_id }
					);
				} catch (error) {
					console.error('Error creating image:', error);
					return new Response('Error processing image command', { status: 500 });
				}

			} else {
				try {
					// prepare context
					context.push({ "role": "user", "content": query })
					const content = await complete(env, chatID, username, context);

					return Telegram.generateSendMessageResponse(chatID, content, {
						"reply_to_message_id": update.message.message_id,
						"reply_markup": { "remove_keyboard": true }
					});
				} catch (error) {
					console.error('Error processing completion:', error);
					return new Response('Error processing message', { status: 500 });
				}

			}
		}


		// message starts with /clear
		if (query.startsWith("/clear")) {
			if (env.CONTEXT && env.CONTEXT > 0 && env.CHATGPT_TELEGRAM_BOT_KV) {
				await Cloudflare.putKVChatContext(env.CHATGPT_TELEGRAM_BOT_KV, chatID, [])
			}
			const content = "COMMAND: Context for the current chat (if it existed) has been cleared."
			if (update.callback_query) {
				await Telegram.sendEditInlineMessageText(env.TELEGRAM_BOT_TOKEN, update.callback_query.inline_message_id, content)
				return Telegram.generateAnswerCallbackQueryResponse(update.callback_query.id, content)
			}
			return Telegram.generateSendMessageResponse(chatID, content, {
				"reply_markup": {
					"remove_keyboard": true,
				}
			})
		}
		// message starts with /context
		if (query.startsWith("/context")) {
			const content = context.length > 0 ? `COMMAND: ${JSON.stringify(context)}` : "COMMAND: Context is empty or not available."
			if (update.callback_query) {
				await Telegram.sendEditInlineMessageText(env.TELEGRAM_BOT_TOKEN, update.callback_query.inline_message_id, content)
				return Telegram.generateAnswerCallbackQueryResponse(update.callback_query.id, content)
			}
			return Telegram.generateSendMessageResponse(chatID, content)
		}

		// truncate context to a maximum of (env.CONTEXT * 2)
		while (context.length > Math.max(1, env.CONTEXT * 2)) {
			context.shift()
		}

		// // prepare context
		// context.push({ "role": "user", "content": query })

		// handle group chat messages
		if (update.message) {
			const isGroupOrSupergroup = update.message.chat.type === "group" || update.message.chat.type === "supergroup";

			// Handling /image command 
			if (query.startsWith("/image")) {
				if (query === "/image@groknear_bot") {
					return Telegram.generateSendMessageResponse(chatID, "Please use /image command plus your image request in both private and group chats to create images. For example, /image a big tree under sunshine.",
						{
							"reply_markup": { "remove_keyboard": true }
						}
					)
				} else {
					try {
						const imagePrompt = query.substring("/image".length).trim();
						const imageUrl = await OpenAI.createImage(env.OPENAI_API_KEY, env.IMAGE_MODEL, imagePrompt);
						return Telegram.generateSendPhotoResponse(
							update.message.chat.id,
							imageUrl,
							{ reply_to_message_id: update.message.message_id }
						);
					} catch (error) {
						console.error('Error creating image:', error);
						return new Response('Error processing image command', { status: 500 });
					}

				}

			}

			// Handling /chat command specifically for group/supergroup chats
			if (isGroupOrSupergroup && query.startsWith("/chat")) {
				if (query === "/chat@groknear_bot") {
					return Telegram.generateSendMessageResponse(chatID, "Please use /chat command plus your query question in group chats to get AI text replies. For example, /chat why near protocol is a great blockchain project?",
						{
							"reply_markup": { "remove_keyboard": true }
						}
					)
				} else {
					try {
						const chatPrompt = query.substring("/chat".length).trim();
						// Prepare context
						context.push({ "role": "user", "content": chatPrompt });
						const content = await complete(env, chatID, username, context);

						return Telegram.generateSendMessageResponse(chatID, content, {
							"reply_to_message_id": update.message.message_id,
							"reply_markup": { "remove_keyboard": true }
						});
					} catch (error) {
						console.error('Error processing completion:', error);
						return new Response('Error processing message', { status: 500 });
					}

				}

			}


		}
		else if (update.callback_query) {
			const callbackQuery = update.callback_query
			ctx.waitUntil(new Promise(async _ => {
				// query OpenAPI with context
				const content = await complete(env, chatID, username, context)

				// edit message with reply
				await Telegram.sendEditInlineMessageText(env.TELEGRAM_BOT_TOKEN, callbackQuery.inline_message_id, `Query: ${query}\n\nAnswer:\n${Telegram.sanitize(content)}`)
			}))
			return Telegram.generateAnswerCallbackQueryResponse(callbackQuery.id, "ChatGPT is processing...")
		}

		// other update
		return new Response(null) // no action (should never happen if allowed_updates is set correctly)
	},
}


async function complete(env: Env, chatID: string, username: string, context: OpenAI.Message[]) {
	const content = await OpenAI.complete(env.OPENAI_API_KEY, env.CHATGPT_MODEL, env.CHATGPT_BEHAVIOR, `tg_${username}`, context)

	// save reply to context
	if (env.CONTEXT && env.CONTEXT > 0 && env.CHATGPT_TELEGRAM_BOT_KV) {
		context.push({ "role": "assistant", "content": content })
		await Cloudflare.putKVChatContext(env.CHATGPT_TELEGRAM_BOT_KV, chatID, context)
	}

	return content
}
