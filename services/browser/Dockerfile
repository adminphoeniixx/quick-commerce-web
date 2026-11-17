# Playwright image ships Chromium, its system deps and Xvfb.
FROM mcr.microsoft.com/playwright/python:v1.64.1-noble
WORKDIR /app
# tini as PID 1: xvfb-run hangs when it runs as PID 1 itself (no compose `init:` needed).
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --chmod=644 *.py ./
RUN python -c "import platforms, blinkit_ads, blinkit_ads_bids, blinkit_ads_campaigns, blinkit_search, blinkit_seller_seo"
COPY --chmod=755 entrypoint.sh /usr/local/bin/qcp-browser-entrypoint
RUN mkdir -p /data/profiles && chown -R pwuser:pwuser /data
ENV PROFILE_DIR=/data/profiles PYTHONUNBUFFERED=1
EXPOSE 8000
# The entrypoint fixes volume ownership as root, then drops to pwuser.
# Headed Chrome on a virtual display: the user sees and drives it through the QCP app.
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/qcp-browser-entrypoint"]
