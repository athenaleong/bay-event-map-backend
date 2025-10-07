#!/usr/bin/env python3
"""
Script to filter exampleResponse by removing places with specific tags
and keeping only specified fields.
"""

import json
import sys


def filter_response(input_file, output_file):
    """Filter the response by removing unwanted tags and keeping only specified fields."""

    # Tags to exclude
    excluded_tags = {"lodging", "selfcare", "night_club"}

    # Fields to keep
    fields_to_keep = {
        "place_id": "id",
        "latitude": "lat",
        "longitude": "lon",
        "name": "name",
        "hours": "hours",
        "summary": "detailed_description",  # Using summary as detailed_description
        "tags": "tags",
        "distance": "distance",  # This might not exist in original, will handle gracefully
    }

    try:
        with open(input_file, "r", encoding="utf-8") as file:
            data = json.load(file)

        if not data.get("success") or "places" not in data:
            print("Error: Invalid JSON structure")
            return False

        filtered_places = []
        removed_count = 0

        for place in data["places"]:
            # Check if place has any of the excluded tags
            place_tags = set(place.get("tags", []))
            if place_tags.intersection(excluded_tags):
                removed_count += 1
                continue

            # Create filtered place with only desired fields
            filtered_place = {}

            for original_field, new_field in fields_to_keep.items():
                if original_field in place:
                    filtered_place[new_field] = place[original_field]
                elif new_field == "distance":
                    # Add distance field if it doesn't exist (set to null)
                    filtered_place[new_field] = None

            filtered_places.append(filtered_place)

        # Create new response structure
        filtered_response = {"success": True, "places": filtered_places}

        # Write filtered response to output file
        with open(output_file, "w", encoding="utf-8") as file:
            json.dump(filtered_response, file, indent=2, ensure_ascii=False)

        print(f"Filtering complete!")
        print(f"Original places: {len(data['places'])}")
        print(f"Removed places: {removed_count}")
        print(f"Filtered places: {len(filtered_places)}")
        print(f"Output saved to: {output_file}")

        return True

    except FileNotFoundError:
        print(f"Error: File '{input_file}' not found")
        return False
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON format - {e}")
        return False
    except Exception as e:
        print(f"Error: {e}")
        return False


def main():
    input_file = "exampleResponse"
    output_file = "exampleResponse_filtered.json"

    print("Filtering exampleResponse...")
    print("Removing places with tags: lodging, selfcare, night_club")
    print(
        "Keeping only: id, lat, lon, name, hours, detailed_description, tags, distance"
    )
    print()

    success = filter_response(input_file, output_file)

    if not success:
        sys.exit(1)


if __name__ == "__main__":
    main()
