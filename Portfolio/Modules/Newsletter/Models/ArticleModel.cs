using System;
using System.Collections.Generic;

namespace Portfolio.Modules.Newsletter.Models
{
    public class ArticleModel
    {
        public string Title { get; set; }
        public string Description { get; set; }
        public DateTime Published_at { get; set; }
        public string Url { get; set; }
        public string Cover_image { get; set; }
        public List<string> Tag_list { get; set; }
        public string Comments_count { get; set; }
        public string Reading_time_minutes { get; set; }
        public string Public_reactions_count { get; set; }
    }
}