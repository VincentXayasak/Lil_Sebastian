# Lil_Sebastian

Types of users: citizens, government workers

Government workers: provdies links to youtube channel/website (location of their video)

Citizen: able to search up and favorite

Dashboard: searchbar, recently listened, favorited

### Outline:
1. YouTube API get transcripts. 
2. Backup plan, get uploaded videos and get transcript using eleven labs. 
3. Once have transcripts, put into Gemini with own personalized prompt to summarize and put as a podcast script. 
4. Put Gemini output into eleven labs to make into podcast with different voices.
6. Get that audio file output from eleven labs and put into app. 
8. Make app into ios and android called "Lil Sebastion". 

"Lil Sebastian" is a brilliant name for a local government transparency app. If
your judges know the reference (from Parks and Recreation), you’ve already won
points for personality. It shows you understand the "bureaucratic" nature of
your problem while keeping the vibe fun.

Your plan is solid. I have one critical technical refinement for your backup
plan (Step 2) to ensure it doesn't fail during the hackathon.

The Refined Workflow for "Lil Sebastian"

1.  YouTube Pipeline: youtube-transcript-api (Fast, free, reliable).
2.  Backup Pipeline (The Change): Use OpenAI Whisper instead of ElevenLabs for
    the backup transcription.
      - Why? ElevenLabs is primarily a Text-to-Speech (TTS) tool. While they
        have speech-to-text, it’s not their core strength. Whisper is the
        industry standard for transcribing audio/video. It is free, runs locally
        (or via API), and is incredibly accurate. It will handle the "uploaded
        video/audio" requirement much better.
3.  The "Podcaster" Logic (Gemini Prompting): To make it sound like a podcast,
    don't just ask for a summary. Ask Gemini to write a script for two hosts
    (e.g., "Host A" and "Host B").
4.  ElevenLabs Multithreading: Use two different voice profiles. Send the "Host
    A" lines to Voice ID #1 and "Host B" lines to Voice ID #2. Concatenate the
    audio files at the end.
5.  App Delivery: React Native + Expo (as discussed).

Step-by-Step Implementation Guide

Part 1: The "Intelligence" (Backend - Python/FastAPI)

The Gemini Prompt (The Secret Sauce): To make the podcast sound authentic, use
this system instruction:

"You are an expert podcast producer. Take this transcript from a local
government meeting and turn it into a 3-minute, high-energy podcast episode
between two hosts: 'Sarah' (the skeptic) and 'Mike' (the policy expert).

Sarah should ask clarifying questions about how the decisions affect regular
people. Mike should explain the policy clearly.

Output format: [Sarah]: ... [Mike]: ... [Sarah]: ...

Focus on: Zoning changes, tax implications, and community events."

The ElevenLabs Integration:

  - Create a script that splits the Gemini output by [Sarah] and [Mike].
  - Call the ElevenLabs API for each block using different voice_id values
    (e.g., pick a friendly female voice for Sarah and a deep, authoritative male
    voice for Mike).
  - Use pydub (a Python library) to stitch the audio clips together into one
    final file (final_podcast.mp3).

Part 2: The "Experience" (Frontend - React Native/Expo)

Since you are using Expo, here is how you build the "Lil Sebastian" player:

1.  The Input Screen:
      - Add a text input box.
      - Add an "Upload" button (use expo-document-picker to let users upload
        local video files).
      - Add a big, styled "Generate Podcast" button.
2.  The Loading Screen (The "Wait" UX):
      - Since AI takes 30-60 seconds, do not let the user stare at a blank
        screen.
      - Show a progress bar with funny "bureaucracy" messages like: "Consulting
        the City Council archives...", "Briefing Lil Sebastian...", "Drafting
        the script...", "Adding professional polish..."
3.  The Player Screen:
      - Use expo-av to play the final_podcast.mp3.
      - Display the text script as a "Read-Along" feature (highlighting the text
        as the audio plays).

Your Winning "Lil Sebastian" Pitch

  - The Problem: "Local government meetings are the 'Lil Sebastian' of the civic
    world—everyone knows they're important, but nobody wants to spend 4 hours in
    the town hall watching them."
  - The Solution: "We built 'Lil Sebastian,' the AI podcast generator that
    translates hours of dry city council footage into a 3-minute, high-energy
    breakdown you can listen to on your way to work."
  - The Demo:
      - Have one pre-recorded video file on your phone (e.g., a boring town
        council clip).
      - Upload it into the app.
      - Show the AI processing.
      - The Reveal: Hit play and have the judges hear a professional-sounding
        podcast immediately.

Hackathon To-Do List:

- [ ] Partner A: Get the FastAPI endpoint working. Test the YouTube API link
  first. Then test the Whisper backup pipeline.
- [ ] Partner B: Get the Expo app "Hello World" running. Build the UI.
- [ ] Both: Spend 1 hour strictly choosing the two "Voices" in ElevenLabs. This
  is the difference between an app that sounds like a toy and an app that sounds
  like a professional product.

Do you have your two voices picked out in ElevenLabs yet? (I recommend one
high-energy/fast and one slow/calm for the best dynamic).
