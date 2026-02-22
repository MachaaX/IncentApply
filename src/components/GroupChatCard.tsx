import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../app/AuthContext";
import {
  useGroupChatMessages,
  useSendGroupChatMessage,
  useToggleGroupChatReaction
} from "../hooks/useAppQueries";

const emojiOptions = ["👍", "🔥", "🎯", "👏", "💪", "🚀", "😂", "❤️"];

function initialsFromName(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  return parts.map((part) => part.charAt(0)).join("").toUpperCase() || "U";
}

function formatMessageTimestamp(value: string, timeZone?: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone
    }).format(parsed);
  } catch {
    return parsed.toLocaleString();
  }
}

export function GroupChatCard({ groupId }: { groupId: string }) {
  const { user } = useAuth();
  const messagesQuery = useGroupChatMessages(groupId);
  const sendMessage = useSendGroupChatMessage();
  const toggleReaction = useToggleGroupChatReaction();
  const [messageDraft, setMessageDraft] = useState("");
  const [replyToMessageId, setReplyToMessageId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const messages = messagesQuery.data ?? [];
  const replyTarget = useMemo(
    () => messages.find((entry) => entry.id === replyToMessageId) ?? null,
    [messages, replyToMessageId]
  );

  useEffect(() => {
    if (!replyToMessageId) {
      return;
    }
    if (!replyTarget) {
      setReplyToMessageId(null);
    }
  }, [replyTarget, replyToMessageId]);

  useEffect(() => {
    if (!listRef.current) {
      return;
    }
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length]);

  const handleSendMessage = async () => {
    const body = messageDraft.trim();
    if (!body || sendMessage.isPending) {
      return;
    }

    try {
      await sendMessage.mutateAsync({
        groupId,
        body,
        replyToMessageId
      });
      setMessageDraft("");
      setReplyToMessageId(null);
    } catch {
      // Surface mutation error through sendMessage.error below.
    }
  };

  const handleToggleReaction = async (messageId: string, emoji: string) => {
    if (toggleReaction.isPending) {
      return;
    }
    try {
      await toggleReaction.mutateAsync({
        groupId,
        messageId,
        emoji
      });
    } catch {
      // Surface mutation error through toggleReaction.error below.
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-primary/10 bg-[#162e25]">
      <div className="border-b border-primary/10 p-6">
        <h2 className="text-2xl font-bold text-white">Group Chat</h2>
        <p className="mt-1 text-sm text-[#92c9b7]">
          Members and admins can discuss progress, reply to messages, and react with emojis.
        </p>
      </div>

      <div ref={listRef} className="max-h-[22rem] overflow-y-auto px-6 py-4">
        {messagesQuery.isLoading ? (
          <p className="text-sm text-slate-400">Loading chat...</p>
        ) : messagesQuery.error ? (
          <p className="text-sm text-secondary-gold">
            {messagesQuery.error instanceof Error
              ? messagesQuery.error.message
              : "Unable to load chat messages."}
          </p>
        ) : messages.length ? (
          <ul className="space-y-3">
            {messages.map((message) => {
              const mine = message.userId === user?.id;
              return (
                <li
                  key={message.id}
                  className={`rounded-xl border p-3 ${
                    mine
                      ? "border-primary/30 bg-primary/10"
                      : "border-primary/15 bg-background-dark/50"
                  }`}
                >
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      {message.sender.avatarUrl ? (
                        <img
                          src={message.sender.avatarUrl}
                          alt={message.sender.name}
                          className="h-8 w-8 rounded-full border border-primary/25 object-cover"
                        />
                      ) : (
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-primary/20 bg-background-dark text-[11px] font-bold text-slate-300">
                          {initialsFromName(message.sender.name)}
                        </span>
                      )}
                      <p className="truncate text-sm font-semibold text-white">
                        {message.sender.name}
                        {mine ? <span className="ml-1 text-[11px] text-primary">(You)</span> : null}
                      </p>
                    </div>
                    <p className="shrink-0 text-[11px] text-slate-500">
                      {formatMessageTimestamp(message.createdAt, user?.timezone)}
                    </p>
                  </div>

                  {message.replyTo ? (
                    <div className="mb-2 rounded-md border border-primary/15 bg-primary/10 px-2 py-1">
                      <p className="text-[11px] font-semibold text-primary">
                        Replying to {message.replyTo.senderName}
                      </p>
                      <p className="max-h-10 overflow-hidden text-xs text-slate-300">
                        {message.replyTo.body}
                      </p>
                    </div>
                  ) : null}

                  <p className="whitespace-pre-wrap text-sm text-slate-100">{message.body}</p>

                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {message.reactions.map((reaction) => (
                      <button
                        key={`${message.id}-${reaction.emoji}`}
                        type="button"
                        onClick={() => void handleToggleReaction(message.id, reaction.emoji)}
                        disabled={toggleReaction.isPending}
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                          reaction.reactedByCurrentUser
                            ? "border-primary/40 bg-primary/20 text-primary"
                            : "border-primary/20 bg-background-dark/40 text-slate-300 hover:border-primary/40 hover:text-white"
                        }`}
                      >
                        <span>{reaction.emoji}</span>
                        <span>{reaction.count}</span>
                      </button>
                    ))}
                    {emojiOptions.map((emoji) => (
                      <button
                        key={`${message.id}-option-${emoji}`}
                        type="button"
                        onClick={() => void handleToggleReaction(message.id, emoji)}
                        disabled={toggleReaction.isPending}
                        className="rounded-full border border-primary/15 bg-background-dark/40 px-2 py-1 text-xs text-slate-300 transition-colors hover:border-primary/35 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                        aria-label={`React ${emoji} to message from ${message.sender.name}`}
                      >
                        {emoji}
                      </button>
                    ))}

                    <button
                      type="button"
                      onClick={() => setReplyToMessageId(message.id)}
                      className="ml-auto rounded-md border border-primary/20 bg-primary/10 px-2 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
                    >
                      Reply
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-slate-400">No messages yet. Start the conversation below.</p>
        )}
      </div>

      <div className="border-t border-primary/10 p-4">
        {replyTarget ? (
          <div className="mb-3 flex items-start justify-between gap-2 rounded-md border border-primary/20 bg-primary/10 px-3 py-2">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-primary">Replying to {replyTarget.sender.name}</p>
              <p className="max-h-10 overflow-hidden text-xs text-slate-300">{replyTarget.body}</p>
            </div>
            <button
              type="button"
              onClick={() => setReplyToMessageId(null)}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-primary/20 text-slate-300 hover:text-white"
              aria-label="Cancel reply"
            >
              <span className="material-icons text-sm">close</span>
            </button>
          </div>
        ) : null}

        <div className="flex items-end gap-2">
          <textarea
            value={messageDraft}
            onChange={(event) => setMessageDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void handleSendMessage();
              }
            }}
            placeholder="Send a message to your group..."
            rows={2}
            maxLength={1000}
            className="min-h-[2.75rem] flex-1 resize-y rounded-lg border border-primary/20 bg-background-dark px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-primary"
          />
          <button
            type="button"
            onClick={() => void handleSendMessage()}
            disabled={sendMessage.isPending || messageDraft.trim().length === 0}
            className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-bold text-background-dark transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sendMessage.isPending ? "Sending..." : "Send"}
          </button>
        </div>

        {sendMessage.error ? (
          <p className="mt-2 text-sm text-secondary-gold">
            {sendMessage.error instanceof Error
              ? sendMessage.error.message
              : "Unable to send message."}
          </p>
        ) : null}
        {toggleReaction.error ? (
          <p className="mt-2 text-sm text-secondary-gold">
            {toggleReaction.error instanceof Error
              ? toggleReaction.error.message
              : "Unable to update reaction."}
          </p>
        ) : null}
      </div>
    </section>
  );
}
