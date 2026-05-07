import discord
from discord.ext import commands, tasks
from datetime import datetime, timedelta
import os

# SAFE TOKEN SYSTEM
TOKEN = os.getenv("MTUwMTU4MDE3NDk2MDEwMzQzNQ.G7s4fv.h3PXpt4kmou_8LW-BKSEYLUYMuwQFEBJyMEwwY")

ROLE_NAME = "inactive"

INVITE_LINK = "https://discord.gg/PjAsYyMjUw"

# LOG CHANNEL ID
LOG_CHANNEL_ID = 1489154443705319435

intents = discord.Intents.default()
intents.members = True
intents.message_content = True

bot = commands.Bot(command_prefix="!", intents=intents)

# Stores last message times
last_message = {}

@bot.event
async def on_ready():
    print(f"Logged in as {bot.user}")
    check_inactive.start()

@bot.event
async def on_message(message):
    if not message.author.bot:
        last_message[message.author.id] = datetime.utcnow()

    await bot.process_commands(message)

# Checks every 1 hour
@tasks.loop(hours=1)
async def check_inactive():

    for guild in bot.guilds:

        role = discord.utils.get(guild.roles, name=ROLE_NAME)

        if role is None:
            continue

        log_channel = bot.get_channel(LOG_CHANNEL_ID)

        for member in guild.members:

            if member.bot:
                continue

            last_seen = last_message.get(member.id)

            # If no message for 3 days
            if last_seen is None or datetime.utcnow() - last_seen > timedelta(days=3):

                if role not in member.roles:

                    try:
                        # Add inactive role
                        await member.add_roles(role)

                        # DM user
                        await member.send(
                            f"⚠️ Sorry, you were removed from the server due to inactivity.\n\n"
                            f"We try to keep the community active, so inactive members are removed automatically.\n\n"
                            f"If you become active again, we’d love to have you back ❤️\n\n"
                            f"Rejoin here:\n{INVITE_LINK}"
                        )

                        # Kick user
                        await member.kick(reason="Inactive for 3 days")

                        print(f"{member} marked inactive and kicked.")

                        # Send log
                        if log_channel:
                            await log_channel.send(
                                f"🚫 {member.mention} was kicked for being inactive for 3 days."
                            )

                    except Exception as e:
                        print(e)

bot.run(TOKEN)