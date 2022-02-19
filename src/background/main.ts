import { search, computePercentage, Message } from '@/common';
import { Icon, Color } from './draw';

import downloads = chrome.downloads;
import DownloadItem = downloads.DownloadItem;
import DownloadDelta = downloads.DownloadDelta;
import runtime = chrome.runtime;

// Size of a tick in milliseconds
export const TICK_MS = 500;

class DownloadManager {

  private static _instance: DownloadManager | null = null;

  private timer: ReturnType<typeof setInterval> | null;
  private icon: Icon;

  /**
   * Holds the downloads that have finished since the user most recently opened
   * their popup.
   */
  private unchecked: DownloadItem[];


  private constructor() {
    this.timer = null;
    this.icon = new Icon();

    this.unchecked = [ ];

    downloads.setShelfEnabled(false);

    downloads.onCreated.addListener(this.onCreated.bind(this));
    downloads.onChanged.addListener(this.onChanged.bind(this));
    downloads.onErased.addListener(this.onErased.bind(this));

    runtime.onMessage.addListener(this.onMessage.bind(this));

    // Draw the icon once on startup
    this.icon.draw();
  }


  public static get Instance() {
    return (this._instance ||= new DownloadManager());
  }


  /**
   * Pings the popup to refresh and starts the timer if necessary.
   */
  private onCreated() {
    runtime.sendMessage(Message.Ping);
    this.start();
  }


  /**
   * Pings the popup to refresh, moves completed downloads into the `unchecked`
   * buffer, and redraws the icon.
   * @param delta The change from the Chrome API.
   */
  private async onChanged(delta: DownloadDelta) {
    runtime.sendMessage(Message.Ping);

    // If it was the state that changed...
    if (delta.state !== undefined) {
      const state = delta.state.current;
      // ...and the state completed, push to the list
      if (state == 'interrupted' || state == 'complete') {
        const [ item ] = await search({ id: delta.id });
        this.unchecked.push(item);

        // Ask the popup to reply with a `PopupOpened` if it is open
        runtime.sendMessage(Message.StatusCheck);
      }
    }

    await this.drawIcon();
  }


  /**
   * Redraws the icon with fresh colours.
   * @param message Message from the popup.
   */
  private onMessage(message: Message) {
    if (message == Message.PopupOpened) {
      // If they opened the popup, clear the unchecked downloads
      this.unchecked = [];
      this.drawIcon();
    }
  }


  /**
   * Pings the popup to refresh.
   */
  private onErased() {
    runtime.sendMessage(Message.Ping);
  }


  /**
   * Starts the timer if necessary.
   */
  public async start() {
    // Don't need to start the timer if it's already running
    if (this.timer !== null) return;

    // or if there are no active downloads
    const activeDownloads = await search({ state: 'in_progress' });
    if (activeDownloads.length <= 0) return;

    console.log('Timer started');

    // Otherwise, start the timer
    this.timer = setInterval(this.tick.bind(this), TICK_MS);
    this.tick();
  }


  /**
   * Stops the timer.
   */
  private stop() {
    if (this.timer === null) return;

    console.log('Timer stopped');

    clearInterval(this.timer);
    this.timer = null;

    // Drawing the icon after downloads complete is handled by the onChanged
    // listener.
  }


  /**
   * Pings the popup to refresh and redraws the icon every `TICK_MS`
   * milliseconds. Stops itself when no more downloads are active.
   */
  private async tick() {
    const activeDownloads = await search({ state: 'in_progress' });

    if (activeDownloads.length > 0) {
      runtime.sendMessage(Message.Ping);
      this.drawIcon();
    } else {
      this.stop();
    }
  }


  /**
   * Draws the currently appropriate icon.
   */
  private async drawIcon() {
    const activeDownloads = await search({ state: 'in_progress' });

    // Determine the colour to draw
    const color = (() => {
      // First priority: check if any of the freshly completed items
      // errored-out (excluding those cancelled by the user).
      if (this.unchecked.some(d => d.state == 'interrupted' && !d.error?.startsWith('USER_')))
        return Color.Error;

      // Second: check if any of the currently active items are paused.
      if (activeDownloads.some(item => item.paused))
        return Color.Paused;

      // Third: check if any of the freshly completed items were successful.
      if (this.unchecked.some(c => c.state == 'complete'))
        return Color.Complete;

      // Otherwise, just use the normal color.
      return Color.Normal;
    })();

    // If anything is actually downloading at the moment, check the total
    // percentage
    if (activeDownloads.length > 0) {
      // Get total completion percentage across all downloads
      const allDownloads = [ ...this.unchecked, ...activeDownloads ];

      // Compute the percentage of all unchecked and active downloads combined
      const { num, den } = allDownloads.reduce((acc, cur) => {
        // Handle edge-case where downloads sometimes (not sure how) end up
        // without a `bytesReceived` property
        if (!cur || !cur.bytesReceived || (!cur.bytesReceived && !cur.fileSize)) {
          return acc;
        } else {
          let { num, den } = computePercentage(cur);
          acc.num += num;
          acc.den += den;
          return acc;
        }
      }, { num: 0, den: 0 });

      this.icon.draw(color, num / den);
    } else {

      // Just draw icon without a progress bar
      this.icon.draw(color);
    }
  }

}


// ====== Initialize ======

DownloadManager.Instance.start();