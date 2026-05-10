# Lil_Sebastian

A podcast app and website that transforms dry local government meeting recordings into funny, engaging audio episodes. Citizens can listen to their city council, planning commission, or other public meetings as a short podcast instead of watching through hours of raw footage.

## How It Works:
1. Video gets uploaded from government worker
2. Convert the video to M4A
3. Transcribe audio using ElevenLabs
4, Generate a podcast script using Gemini
5. Synthesize multi-voice audio using ElevenLabs TTS
6. Upload as Mp3 into a Supabase Storage
7. Citizens can listen in their mobile app or website

## Setup
### Prerequisites
- Python 3.10+
- npm and Node.js 18+
- Expo CLI
- ffmpeg installed and on your PATH
- A Supabase API Key
- ElevenLabs API Key
- Google Gemini API Key

1. Clone and install python dependencies

2. configur environment variables

3. run the website and app

## The Cast
| Role | Character |
| **Narrator** | Narrates transitions, intros and outros |
| **Ben** | Co-host. |
| ** Leslie** | Co-host |
| ** Patrick** | Guest |

## User Roles
**Citizens** - free to open the app or website to browse episodes by city, search for their town, listent o recent meetings, and track their recently played

**Government workers** - able to upload a meeting video through the website.


