#!/usr/bin/env python3
"""
Script to analyze tags in the exampleResponse JSON file.
Counts the frequency of each tag across all places.
"""

import json
from collections import Counter
import sys


def analyze_tags(file_path):
    """Analyze tags in the JSON file and return tag counts."""
    try:
        with open(file_path, "r", encoding="utf-8") as file:
            data = json.load(file)

        if not data.get("success") or "places" not in data:
            print("Error: Invalid JSON structure")
            return None

        all_tags = []
        places_with_tags = 0
        places_without_tags = 0

        for place in data["places"]:
            if "tags" in place and place["tags"]:
                all_tags.extend(place["tags"])
                places_with_tags += 1
            else:
                places_without_tags += 1

        # Count tag frequencies
        tag_counts = Counter(all_tags)

        return {
            "tag_counts": tag_counts,
            "total_places": len(data["places"]),
            "places_with_tags": places_with_tags,
            "places_without_tags": places_without_tags,
            "total_tags": len(all_tags),
            "unique_tags": len(tag_counts),
        }

    except FileNotFoundError:
        print(f"Error: File '{file_path}' not found")
        return None
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON format - {e}")
        return None
    except Exception as e:
        print(f"Error: {e}")
        return None


def print_results(analysis):
    """Print the analysis results in a formatted way."""
    if not analysis:
        return

    print("=" * 60)
    print("TAG ANALYSIS RESULTS")
    print("=" * 60)
    print(f"Total places: {analysis['total_places']}")
    print(f"Places with tags: {analysis['places_with_tags']}")
    print(f"Places without tags: {analysis['places_without_tags']}")
    print(f"Total tag instances: {analysis['total_tags']}")
    print(f"Unique tags: {analysis['unique_tags']}")
    print()

    print("TAG FREQUENCY (sorted by count):")
    print("-" * 40)

    # Sort tags by frequency (descending)
    sorted_tags = analysis["tag_counts"].most_common()

    for tag, count in sorted_tags:
        percentage = (count / analysis["total_tags"]) * 100
        print(f"{tag:<25} {count:>6} ({percentage:>5.1f}%)")

    print()
    print("TAG FREQUENCY (alphabetical):")
    print("-" * 40)

    # Sort tags alphabetically
    sorted_tags_alpha = sorted(analysis["tag_counts"].items())

    for tag, count in sorted_tags_alpha:
        percentage = (count / analysis["total_tags"]) * 100
        print(f"{tag:<25} {count:>6} ({percentage:>5.1f}%)")


def main():
    file_path = "exampleResponse"

    print("Analyzing tags in exampleResponse...")
    analysis = analyze_tags(file_path)

    if analysis:
        print_results(analysis)

        # Save results to a file
        output_file = "tag_analysis_results.txt"
        with open(output_file, "w", encoding="utf-8") as f:
            f.write("TAG ANALYSIS RESULTS\n")
            f.write("=" * 60 + "\n")
            f.write(f"Total places: {analysis['total_places']}\n")
            f.write(f"Places with tags: {analysis['places_with_tags']}\n")
            f.write(f"Places without tags: {analysis['places_without_tags']}\n")
            f.write(f"Total tag instances: {analysis['total_tags']}\n")
            f.write(f"Unique tags: {analysis['unique_tags']}\n\n")

            f.write("TAG FREQUENCY (sorted by count):\n")
            f.write("-" * 40 + "\n")
            sorted_tags = analysis["tag_counts"].most_common()
            for tag, count in sorted_tags:
                percentage = (count / analysis["total_tags"]) * 100
                f.write(f"{tag:<25} {count:>6} ({percentage:>5.1f}%)\n")

        print(f"\nResults also saved to: {output_file}")
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
