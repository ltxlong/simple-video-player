declare module 'dplayer' {
  export interface DPlayerOptions {
    container: HTMLElement;
    mutex: boolean;
    screenshot: boolean;
    airplay: boolean;
    chromecast: boolean;
    live: boolean;
    video: {
      url: string;
      type?: string;
      pic?: string; 
      customType?: {
        [key: string]: (video: HTMLVideoElement, player: DPlayer) => void;
      };
    };
    autoplay?: boolean;
    theme?: string;
    lang?: string;
    hotkey?: boolean;
    preload?: string;
    volume?: number;
    playbackSpeed?: number[];
    contextmenu?: Array;
  }

  export default class DPlayer {
    constructor(options: DPlayerOptions);
    destroy(): void;
    play(): void;
    pause(): void;
    notice(text: string, time?: number, opacity?: number): void;
    switchVideo(video: { url: string; type?: string }): void;
    video: HTMLVideoElement;
    on(event: string, callback: (...args: any[]) => void): void;
  }
} 
