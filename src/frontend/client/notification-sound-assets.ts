/// <reference path="./notification-sounds.d.ts" />
/** Lazy-loaded and emitted beside the browser chunks by the standard Zero build. */
import chat from './sounds/chat-message.mp3';
import notification from './sounds/notification.mp3';
export const notificationSoundSources = {
  chat: new URL(chat, import.meta.url).href,
  notification: new URL(notification, import.meta.url).href,
};
