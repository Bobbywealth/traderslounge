import React, { useState } from 'react';
import { Play, FileText, GraduationCap, Search, Clock, Star } from 'lucide-react';

const Education: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');

  const courses = [
    {
      id: 1,
      title: 'Forex Trading Fundamentals',
      type: 'course',
      category: 'Beginner',
      duration: '4 hours',
      progress: 85,
      rating: 4.8,
      students: 2456,
      description: 'Learn the basics of forex trading, currency pairs, and market analysis.',
      thumbnail: 'https://images.pexels.com/photos/186461/pexels-photo-186461.jpeg?auto=compress&cs=tinysrgb&w=800',
    },
    {
      id: 2,
      title: 'Advanced Technical Analysis',
      type: 'video',
      category: 'Advanced',
      duration: '45 min',
      progress: 0,
      rating: 4.9,
      students: 1823,
      description: 'Master advanced chart patterns, indicators, and trading strategies.',
      thumbnail: 'https://images.pexels.com/photos/7567565/pexels-photo-7567565.jpeg?auto=compress&cs=tinysrgb&w=800',
    },
    {
      id: 3,
      title: 'Risk Management Strategies',
      type: 'article',
      category: 'Intermediate',
      duration: '15 min read',
      progress: 100,
      rating: 4.7,
      students: 3421,
      description: 'Essential risk management techniques for consistent trading success.',
      thumbnail: 'https://images.pexels.com/photos/6801648/pexels-photo-6801648.jpeg?auto=compress&cs=tinysrgb&w=800',
    },
    {
      id: 4,
      title: 'Psychology of Trading',
      type: 'course',
      category: 'Intermediate',
      duration: '3 hours',
      progress: 45,
      rating: 4.6,
      students: 1956,
      description: 'Understand trading psychology and develop mental discipline.',
      thumbnail: 'https://images.pexels.com/photos/8867482/pexels-photo-8867482.jpeg?auto=compress&cs=tinysrgb&w=800',
    },
    {
      id: 5,
      title: 'Cryptocurrency Trading Guide',
      type: 'video',
      category: 'Advanced',
      duration: '1 hour',
      progress: 0,
      rating: 4.8,
      students: 2134,
      description: 'Complete guide to trading cryptocurrencies and digital assets.',
      thumbnail: 'https://images.pexels.com/photos/6765363/pexels-photo-6765363.jpeg?auto=compress&cs=tinysrgb&w=800',
    },
    {
      id: 6,
      title: 'Market Analysis Report',
      type: 'article',
      category: 'Beginner',
      duration: '10 min read',
      progress: 0,
      rating: 4.5,
      students: 4123,
      description: 'Weekly market analysis and upcoming trading opportunities.',
      thumbnail: 'https://images.pexels.com/photos/6802042/pexels-photo-6802042.jpeg?auto=compress&cs=tinysrgb&w=800',
    },
  ];

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'video':
        return Play;
      case 'article':
        return FileText;
      case 'course':
        return GraduationCap;
      default:
        return FileText;
    }
  };

  const filteredCourses = courses.filter(course => {
    const matchesSearch = course.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         course.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || course.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Education Hub</h1>
        <div className="text-sm text-gray-600 dark:text-gray-400">
          {filteredCourses.length} resources available
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <div className="flex flex-col md:flex-row md:items-center space-y-4 md:space-y-0 md:space-x-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search courses, videos, and articles..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 w-full border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            />
          </div>
          
          <div className="flex space-x-2">
            {['All', 'Beginner', 'Intermediate', 'Advanced'].map((category) => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-200 ${
                  selectedCategory === category
                    ? 'bg-emerald-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {category}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {filteredCourses.map((course) => {
          const TypeIcon = getTypeIcon(course.type);
          
          return (
            <div
              key={course.id}
              className="bg-white dark:bg-gray-800 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-shadow duration-200"
            >
              <div className="relative">
                <img
                  src={course.thumbnail}
                  alt={course.title}
                  className="w-full h-48 object-cover"
                />
                <div className="absolute top-4 left-4">
                  <div className="flex items-center space-x-2 bg-black bg-opacity-75 text-white px-3 py-1 rounded-lg">
                    <TypeIcon className="w-4 h-4" />
                    <span className="text-sm capitalize">{course.type}</span>
                  </div>
                </div>
                <div className="absolute top-4 right-4">
                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                    course.category === 'Beginner'
                      ? 'bg-green-100 text-green-800'
                      : course.category === 'Intermediate'
                      ? 'bg-yellow-100 text-yellow-800'
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {course.category}
                  </span>
                </div>
              </div>

              <div className="p-6">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
                  {course.title}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  {course.description}
                </p>

                <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400 mb-4">
                  <div className="flex items-center space-x-1">
                    <Clock className="w-4 h-4" />
                    <span>{course.duration}</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <Star className="w-4 h-4 text-yellow-400 fill-current" />
                    <span>{course.rating}</span>
                    <span>({course.students})</span>
                  </div>
                </div>

                {course.progress > 0 && (
                  <div className="mb-4">
                    <div className="flex items-center justify-between text-sm mb-2">
                      <span className="text-gray-600 dark:text-gray-400">Progress</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                        {course.progress}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                      <div
                        className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${course.progress}%` }}
                      ></div>
                    </div>
                  </div>
                )}

                <button className="w-full bg-emerald-500 text-white py-2 px-4 rounded-lg font-medium hover:bg-emerald-600 transition-colors duration-200">
                  {course.progress > 0 ? 'Continue Learning' : 'Start Learning'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Education;