import matplotlib.pyplot as plt
import matplotlib.patches as mpatches

# ─────────────────────────────────────────────
#  ADJUSTABLE PARAMETERS  ← change these freely
# ─────────────────────────────────────────────

# Bar values (percentages)
workforce_value = 19
injury_value    = 30

# Bar appearance
BAR_HEIGHT      = 0.35      # height of each bar  (increase → taller bars)
MAX_WIDTH       = 40        # max x-axis value    (affects relative bar length)

# Colors
COLOR_WORKFORCE = "#C8860A"   # golden-brown
COLOR_INJURY    = "#8B2020"   # dark red
COLOR_BORDER    = "#7B2FBE"   # purple frame

# Font sizes
LABEL_FONTSIZE  = 16   # "Workforce share" / "Injury share" text
VALUE_FONTSIZE  = 18   # percentage labels (19%, 30%)

# Figure size (width, height) in inches
FIG_WIDTH       = 10
FIG_HEIGHT      = 4

# Padding between bar end and percentage label
LABEL_PAD       = 0.8

# ─────────────────────────────────────────────
#  CHART DRAWING  (no need to edit below here)
# ─────────────────────────────────────────────

fig, ax = plt.subplots(figsize=(FIG_WIDTH, FIG_HEIGHT))

categories = ["Workforce share", "Injury share"]
values     = [workforce_value, injury_value]
colors     = [COLOR_WORKFORCE, COLOR_INJURY]
y_pos      = [1, 0]          # y positions for the two bars

for y, val, color, label in zip(y_pos, values, colors, categories):
    # Draw bar
    ax.barh(y, val, height=BAR_HEIGHT, color=color, align="center")

    # Percentage label to the right of bar
    ax.text(
        val + LABEL_PAD, y,
        f"{val}%",
        va="center", ha="left",
        fontsize=VALUE_FONTSIZE,
        fontweight="bold",
        color=color,
    )

# Category labels on the left
ax.set_yticks(y_pos)
ax.set_yticklabels(categories, fontsize=LABEL_FONTSIZE, color="#444444")

# Clean up axes
ax.set_xlim(0, MAX_WIDTH)
ax.set_ylim(-0.6, 1.6)
ax.axis("off")
ax.yaxis.set_tick_params(length=0)

# Re-draw tick labels manually (axis is off, so place them)
for y, label in zip(y_pos, categories):
    ax.text(
        -1, y, label,
        va="center", ha="right",
        fontsize=LABEL_FONTSIZE,
        color="#444444",
    )

# Purple border frame
for spine in ["top", "bottom", "left", "right"]:
    ax.spines[spine].set_visible(False)

rect = mpatches.FancyBboxPatch(
    (0.01, 0.05), 0.98, 0.90,
    boxstyle="round,pad=0.02",
    linewidth=2,
    edgecolor=COLOR_BORDER,
    facecolor="none",
    transform=fig.transFigure,
    clip_on=False,
)
fig.add_artist(rect)

plt.tight_layout(pad=1.5)
plt.savefig("bar_chart_output.png", dpi=150, bbox_inches="tight")
plt.show()
print("Chart saved as bar_chart_output.png")