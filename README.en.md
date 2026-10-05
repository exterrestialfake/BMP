# Bilibili as Music Player: Request music in Codex while you code

[中文](README.md) | [English](README.en.md)

**Request music in chat. Control playback with a floating widget. Stay with your work when you want to change tracks.**

## Background
Many people enjoy listening to music while coding. Familiar melodies can make work more enjoyable, and the right rhythm can help them settle into a focused routine. When working with Codex, we want music to fit naturally into that workflow, with fewer interruptions to request or change a track.

## How people listen today
Usually, we open a separate music website or desktop app, search for a song, choose a version, and start playback. To change tracks, we switch back to the player, make a selection, and then return to Codex.

## The problems
- **Access can be restricted.** Some songs require a paid subscription for full playback, so the music we want is not always available to us.
- **The catalog may not match our taste.** DJ edits, covers, remixes, and newly popular versions are not always available on music services. For a track such as “琵琶曲 DJ” (Pipa DJ), we may end up looking on Bilibili instead.
- **Playback controls interrupt work.** Switching between windows to search, choose a track, or skip a song can become frustrating and distract us from the task at hand.

## Our solution
Bilibili as Music Player lets you search Bilibili videos directly in Codex chat, choose a version, and play its audio. There is no need to open a Bilibili webpage or a separate music app, and the Agent does not need to operate a browser.

- **Request music in chat.** Give Codex a song name, a version, or a BV ID, and it uses the plugin to search and play.
- **See the details before choosing.** Results include the title, uploader, duration, publication date, BV ID, video link, and cover image to help you distinguish versions.
- **Keep common controls within reach.** A floating panel provides pause/resume, previous/next, repeat one, sequential playback, and volume controls. You do not need to send a chat message and wait for the Agent for every action.
- **Collapse the panel into a floating widget.** Drag it to a convenient position and click it to expand the controls, keeping screen space clear.
- **Keep listening across chats.** Playback is managed separately from the current chat, so switching Codex chats does not interrupt your music.

The current version is for **Codex running locally on Windows**, with audio played through your computer's audio device. Search and playback target public videos that do not require login; availability still depends on Bilibili's video permissions and service status.

### Source available for inspection
This repository provides the plugin's source code. You can inspect how search, playback control, and the floating panel work. The plugin does not read browser cookies; candidate cover images are cached locally. See the [third-party software notices](THIRD_PARTY_NOTICES.md) to review the external programs it uses.

## Examples: request music in chat
### Search and choose a version
> You: Search for 琵琶曲 DJ and let me choose a version.
>
> Codex: Displays numbered candidates with video details and cover images.
>
> You: Play number 2.
> 
A keyword search does not automatically play the first result. Playback starts after you choose a candidate. Each new search replaces the previous candidate list.

### Play a specific video
> Play the audio from the video with this BV ID.

You can also send a Bilibili video link to specify the version you want.

### Control playback with a short message
- “Pause” / “Resume”
- “Set the volume to 40”
- “Previous track” / “Next track”
- “Enable repeat one” / “Enable sequential playback”
- “What is playing, and how far along is it?”
“Stop playback” is treated as pause. Resuming continues from the same position.

### Navigate your playback history
Previous, next, and sequential playback follow the history of videos you have actually played. They do not advance to unplayed search candidates. Requesting the same BV video again moves it to the end of the history, with only one entry retained.
In sequential mode, playback advances to the next history entry when the current video ends, then stops at the end of the history. Repeat one loops the current video. With both modes off, playback stops when the video ends.

### Use the floating controls
The floating panel appears when the playback service connects. Use its buttons to pause, resume, change tracks, or select a playback mode, and drag the volume slider to adjust volume. When the slider has keyboard focus, each press of the left or right arrow key changes the volume by 1%.
Click the button in the panel's upper-right corner to collapse it into a floating widget. Drag the widget to move it, or click it to expand the panel again. Collapsing the panel does not affect playback. Music preferences are not yet available; that button is currently disabled.

## Installation
**The Windows EXE installer will be distributed through this repository's GitHub Releases.** A download link will be added when the release is published.

This repository provides source code for inspection. The installer prepares the runtime dependencies automatically; the first installation requires internet access to download a fixed version of mpv. Users will not need to configure JSON files or MCP commands manually.

## License

The project's source code is licensed under the [MIT License](LICENSE). Third-party software retains its respective licenses; see [third-party software notices](THIRD_PARTY_NOTICES.md).
