#!/usr/bin/env python3
"""
Script to filter places by their operating hours.
Takes a time, day of week, and list of places, returns which places are open.
"""

import json
import re
from datetime import datetime, time
from typing import List, Dict, Any, Optional
import argparse
import sys


class PlaceHoursFilter:
    """Class to handle filtering places by operating hours."""

    def __init__(self):
        # Day name mapping
        self.day_mapping = {
            "monday": "Monday",
            "tuesday": "Tuesday",
            "wednesday": "Wednesday",
            "thursday": "Thursday",
            "friday": "Friday",
            "saturday": "Saturday",
            "sunday": "Sunday",
            "mon": "Monday",
            "tue": "Tuesday",
            "wed": "Wednesday",
            "thu": "Thursday",
            "fri": "Friday",
            "sat": "Saturday",
            "sun": "Sunday",
        }

    def parse_time(self, time_str: str) -> time:
        """Parse time string in various formats to time object."""
        time_str = time_str.strip().upper()

        # Handle different time formats
        if "AM" in time_str or "PM" in time_str:
            # Format: "6:00 AM", "2:00 PM", etc.
            time_match = re.search(r"(\d{1,2}):(\d{2})\s*(AM|PM)", time_str)
            if time_match:
                hour = int(time_match.group(1))
                minute = int(time_match.group(2))
                period = time_match.group(3)

                if period == "AM" and hour == 12:
                    hour = 0
                elif period == "PM" and hour != 12:
                    hour += 12

                return time(hour, minute)
        else:
            # Format: "14:30", "6:00", etc.
            time_match = re.search(r"(\d{1,2}):(\d{2})", time_str)
            if time_match:
                hour = int(time_match.group(1))
                minute = int(time_match.group(2))
                return time(hour, minute)

        raise ValueError(f"Unable to parse time: {time_str}")

    def parse_day(self, day_str: str) -> str:
        """Parse day string to standardized day name."""
        day_lower = day_str.strip().lower()
        if day_lower in self.day_mapping:
            return self.day_mapping[day_lower]
        raise ValueError(f"Invalid day: {day_str}")

    def parse_hours_string(self, hours_str: str) -> List[tuple]:
        """Parse a single day's hours string into time ranges."""
        hours_str = hours_str.strip()

        # Handle special cases
        if "closed" in hours_str.lower():
            return []
        if "24 hours" in hours_str.lower() or "open 24 hours" in hours_str.lower():
            return [(time(0, 0), time(23, 59))]

        # Extract time ranges using regex
        # Pattern matches: "6:00 AM – 2:00 PM" or "11:00 AM – 3:00 PM, 5:00 – 10:00 PM"
        time_ranges = []

        # Split by comma for multiple ranges in one day
        ranges = [r.strip() for r in hours_str.split(",")]

        for range_str in ranges:
            # Find time patterns in the range
            time_pattern = (
                r"(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*[–-]\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)"
            )
            match = re.search(time_pattern, range_str)

            if match:
                start_time_str = match.group(1)
                end_time_str = match.group(2)

                try:
                    start_time = self.parse_time(start_time_str)
                    end_time = self.parse_time(end_time_str)
                    time_ranges.append((start_time, end_time))
                except ValueError as e:
                    print(f"Warning: Could not parse time range '{range_str}': {e}")
                    continue

        return time_ranges

    def is_place_open(
        self, place: Dict[str, Any], query_time: time, query_day: str
    ) -> bool:
        """Check if a place is open at the given time and day."""
        if "hours" not in place or not place["hours"]:
            return False

        # Find the hours for the requested day
        day_hours = None
        for hours_entry in place["hours"]:
            if hours_entry.startswith(query_day + ":"):
                day_hours = hours_entry
                break

        if not day_hours:
            return False

        # Parse the hours for this day
        time_ranges = self.parse_hours_string(day_hours)

        # Check if query time falls within any of the time ranges
        for start_time, end_time in time_ranges:
            if start_time <= query_time <= end_time:
                return True

        return False

    def filter_open_places(
        self, places: List[Dict[str, Any]], query_time: time, query_day: str
    ) -> List[Dict[str, Any]]:
        """Filter places to return only those open at the given time and day."""
        open_places = []

        for place in places:
            if self.is_place_open(place, query_time, query_day):
                # Create a copy of the place without the hours field
                place_copy = place.copy()
                place_copy.pop("hours", None)  # Remove hours field
                open_places.append(place_copy)

        return open_places

    def load_places_from_file(self, file_path: str) -> List[Dict[str, Any]]:
        """Load places from a JSON file."""
        try:
            with open(file_path, "r", encoding="utf-8") as file:
                data = json.load(file)

            if not data.get("success") or "places" not in data:
                raise ValueError(
                    "Invalid JSON structure - missing 'success' or 'places'"
                )

            return data["places"]
        except FileNotFoundError:
            raise FileNotFoundError(f"File '{file_path}' not found")
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON format: {e}")


def main():
    """Main function with CLI interface."""
    parser = argparse.ArgumentParser(description="Filter places by operating hours")
    parser.add_argument("time", help='Time to check (e.g., "2:30 PM", "14:30")')
    parser.add_argument("day", help='Day of week (e.g., "Monday", "mon", "monday")')
    parser.add_argument(
        "--file",
        "-f",
        default="exampleResponse_filtered.json",
        help="JSON file containing places data (default: exampleResponse_filtered.json)",
    )
    parser.add_argument("--output", "-o", help="Output file to save results (optional)")
    parser.add_argument(
        "--verbose", "-v", action="store_true", help="Show detailed output"
    )

    args = parser.parse_args()

    try:
        # Initialize filter
        filter_obj = PlaceHoursFilter()

        # Parse input
        query_time = filter_obj.parse_time(args.time)
        query_day = filter_obj.parse_day(args.day)

        # Load places
        places = filter_obj.load_places_from_file(args.file)

        # Filter open places
        open_places = filter_obj.filter_open_places(places, query_time, query_day)

        # Display results
        print(
            f"Checking places open on {query_day} at {query_time.strftime('%I:%M %p')}"
        )
        print(f"Total places: {len(places)}")
        print(f"Open places: {len(open_places)}")
        print()

        if args.verbose:
            print("Open places:")
            print("-" * 50)
            for place in open_places:
                print(f"• {place['name']} (ID: {place['id']})")
                if "tags" in place:
                    print(f"  Tags: {', '.join(place['tags'])}")
                if "detailed_description" in place:
                    print(f"  Description: {', '.join(place['detailed_description'])}")
                print(
                    f"  Location: {place.get('lat', 'N/A')}, {place.get('lon', 'N/A')}"
                )
                print()
        else:
            print("Open places:")
            for place in open_places:
                print(f"• {place['name']} (ID: {place['id']})")
                if "tags" in place:
                    print(f"  Tags: {', '.join(place['tags'])}")
                print(
                    f"  Location: {place.get('lat', 'N/A')}, {place.get('lon', 'N/A')}"
                )
                print()

        # Save to output file if specified
        if args.output:
            result = {
                "query_time": query_time.strftime("%H:%M"),
                "query_day": query_day,
                "total_places": len(places),
                "open_places_count": len(open_places),
                "open_places": open_places,
            }

            with open(args.output, "w", encoding="utf-8") as f:
                json.dump(result, f, indent=2, ensure_ascii=False, default=str)

            print(f"\nResults saved to: {args.output}")

    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
