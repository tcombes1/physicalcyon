module CadModelsHelper
  def status_badge_class(status)
    case status.to_sym
    when :pending    then "bg-gray-100 text-gray-600"
    when :processing then "bg-blue-100 text-blue-700"
    when :done       then "bg-green-100 text-green-700"
    when :failed     then "bg-red-100 text-red-700"
    end
  end
end
