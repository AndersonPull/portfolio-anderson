using System;
using System.Collections.Generic;
using Newtonsoft.Json;

namespace Portfolio.Modules.Newsletter.Models
{
    public class ArticleModel
    {
        [JsonProperty("title")]
        public string Title { get; set; }

        [JsonProperty("description")]
        public string Description { get; set; }

        [JsonProperty("published_at")]
        public DateTime PublishedAt { get; set; }

        [JsonProperty("url")]
        public string Url { get; set; }

        [JsonProperty("cover_image")]
        public string CoverImage { get; set; }

        [JsonProperty("tag_list")]
        public List<string> TagList { get; set; }

        [JsonProperty("comments_count")]
        public string CommentsCount { get; set; }

        [JsonProperty("reading_time_minutes")]
        public string ReadingTimeMinutes { get; set; }

        [JsonProperty("public_reactions_count")]
        public string PublicReactionsCount { get; set; }

        [JsonProperty("body_markdown")]
        public string BodyMarkdown { get; set; }
        
    }
}